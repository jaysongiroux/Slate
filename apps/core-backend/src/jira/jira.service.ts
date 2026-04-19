import { createId } from "@paralleldrive/cuid2";
import type { PrismaClient } from "@prisma/client";
import { Version3Client, AgileClient } from "jira.js";
import {
  JIRA_INSTANCES_SETTING_KEY,
  JIRA_TOKENS_SETTING_KEY,
  type JiraInstance,
  type JiraInstanceType,
  type JiraProject,
  type JiraIssue,
  type JiraIssueRef,
  type JiraStatus,
  type JiraUser,
  type JiraPriority,
  type JiraIssueType,
  type JiraComment,
  type JiraTransition,
  type JiraFieldMeta,
  type JiraIssuesResponse,
  type JiraProjectsResponse,
  type JiraBoard,
  type JiraBoardColumn,
  type JiraSprint,
} from "@slate/shared";
import { encryptSecret, decryptSecret } from "../ai/encryption.util";

// ---------------------------------------------------------------------------
// Standard fields we already handle — exclude from "custom fields" lists
// ---------------------------------------------------------------------------

/** Wrap a plain string in a minimal ADF document structure. */
function textToAdf(text: string): object {
  return {
    version: 1,
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

/**
 * Jira V3 rich-text custom fields require ADF, not plain strings.
 * If a custom field value is a plain string, wrap it in ADF.
 * Objects (already ADF or {id} references) are passed through.
 */
function prepareCustomFields(fields: Record<string, unknown>): Record<string, unknown> {
  const prepared: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string" && key.startsWith("customfield_")) {
      prepared[key] = textToAdf(value);
    } else {
      prepared[key] = value;
    }
  }
  return prepared;
}

const STANDARD_FIELD_IDS = new Set([
  "summary",
  "description",
  "issuetype",
  "project",
  "assignee",
  "reporter",
  "priority",
  "labels",
  "status",
  "resolution",
  "attachment",
  "comment",
  "issuelinks",
  "subtasks",
  "parent",
  "timetracking",
  "worklog",
  "fixVersions",
  "versions",
  "components",
  "duedate",
  "environment",
  "security",
]);

// ---------------------------------------------------------------------------
// Helpers – map Jira REST responses → Slate types
// ---------------------------------------------------------------------------

/** Extract plain text from an ADF (Atlassian Document Format) object. */
function adfToText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text ?? "";
  if (Array.isArray(node.content)) {
    const parts = node.content.map(adfToText);
    // Add newlines between block-level nodes
    if (node.type === "doc" || node.type === "bulletList" || node.type === "orderedList") {
      return parts.join("\n");
    }
    if (node.type === "paragraph" || node.type === "heading" || node.type === "listItem") {
      return parts.join("");
    }
    return parts.join("");
  }
  return "";
}

/** Escape HTML special characters. */
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert an ADF node tree to HTML. */
function adfToHtml(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return escHtml(node);

  if (node.type === "text") {
    let html = escHtml(node.text ?? "");
    if (Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        switch (mark.type) {
          case "strong":
            html = `<strong>${html}</strong>`;
            break;
          case "em":
            html = `<em>${html}</em>`;
            break;
          case "code":
            html = `<code>${html}</code>`;
            break;
          case "underline":
            html = `<u>${html}</u>`;
            break;
          case "strike":
            html = `<s>${html}</s>`;
            break;
          case "link":
            html = `<a href="${escHtml(mark.attrs?.href ?? "")}" target="_blank" rel="noopener noreferrer">${html}</a>`;
            break;
          case "textColor":
            html = `<span style="color:${escHtml(mark.attrs?.color ?? "")}">${html}</span>`;
            break;
        }
      }
    }
    return html;
  }

  if (node.type === "hardBreak") return "<br/>";
  if (node.type === "rule") return "<hr/>";

  if (node.type === "mention")
    return `<span class="adf-mention">@${escHtml(node.attrs?.text?.replace(/^@/, "") ?? "")}</span>`;
  if (node.type === "emoji") return node.attrs?.text ?? node.attrs?.shortName ?? "";
  if (node.type === "inlineCard") {
    const url = node.attrs?.url ?? "";
    return `<a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">${escHtml(url)}</a>`;
  }

  const children = Array.isArray(node.content) ? node.content.map(adfToHtml).join("") : "";

  switch (node.type) {
    case "doc":
      return children;
    case "paragraph":
      return `<p>${children}</p>`;
    case "heading":
      return `<h${node.attrs?.level ?? 3}>${children}</h${node.attrs?.level ?? 3}>`;
    case "blockquote":
      return `<blockquote>${children}</blockquote>`;
    case "codeBlock":
      return `<pre><code${node.attrs?.language ? ` class="language-${escHtml(node.attrs.language)}"` : ""}>${children}</code></pre>`;
    case "bulletList":
      return `<ul>${children}</ul>`;
    case "orderedList":
      return `<ol>${children}</ol>`;
    case "listItem":
      return `<li>${children}</li>`;
    case "table":
      return `<table>${children}</table>`;
    case "tableRow":
      return `<tr>${children}</tr>`;
    case "tableHeader":
      return `<th>${children}</th>`;
    case "tableCell":
      return `<td>${children}</td>`;
    case "panel":
      return `<div class="adf-panel adf-panel-${escHtml(node.attrs?.panelType ?? "info")}">${children}</div>`;
    case "mediaSingle":
      return `<div class="adf-media">${children}</div>`;
    case "media":
      if (node.attrs?.url) return `<img src="${escHtml(node.attrs.url)}" alt="" />`;
      return "";
    default:
      return children;
  }
}

function mapStatusCategory(key: string | undefined): "todo" | "in_progress" | "done" | "unknown" {
  switch (key) {
    case "new":
      return "todo";
    case "indeterminate":
      return "in_progress";
    case "done":
      return "done";
    default:
      return "unknown";
  }
}

function mapStatus(raw: any): JiraStatus {
  return {
    id: String(raw?.id ?? ""),
    name: raw?.name ?? "",
    statusCategory: mapStatusCategory(raw?.statusCategory?.key),
  };
}

function mapUser(raw: any): JiraUser | null {
  if (!raw) return null;
  return {
    accountId: raw.accountId ?? raw.key ?? "",
    displayName: raw.displayName ?? "",
    avatarUrl: raw.avatarUrls?.["32x32"] ?? null,
    emailAddress: raw.emailAddress ?? null,
  };
}

function mapPriority(raw: any): JiraPriority | null {
  if (!raw) return null;
  return {
    id: String(raw.id ?? ""),
    name: raw.name ?? "",
    iconUrl: raw.iconUrl ?? null,
  };
}

function mapIssueType(raw: any): JiraIssueType {
  return {
    id: String(raw?.id ?? ""),
    name: raw?.name ?? "",
    iconUrl: raw?.iconUrl ?? null,
    subtask: raw?.subtask ?? false,
  };
}

function mapIssueRef(raw: any): JiraIssueRef | null {
  if (!raw) return null;
  return {
    id: String(raw.id ?? ""),
    key: raw.key ?? "",
    summary: raw.fields?.summary ?? "",
    status: mapStatus(raw.fields?.status),
  };
}

function isAdfDocument(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as any).type === "doc" &&
    Array.isArray((value as any).content)
  );
}

function extractCustomFields(fields: Record<string, any>): Record<string, unknown> {
  const custom: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith("customfield_") && value != null) {
      // Convert ADF documents to plain text so the frontend can display and edit them
      custom[key] = isAdfDocument(value) ? adfToText(value) : value;
    }
  }
  return custom;
}

function mapIssue(raw: any): JiraIssue {
  const fields = raw.fields ?? {};
  return {
    id: String(raw.id ?? ""),
    key: raw.key ?? "",
    summary: fields.summary ?? "",
    description:
      typeof fields.description === "string"
        ? fields.description
        : fields.description
          ? adfToText(fields.description)
          : null,
    descriptionHtml:
      typeof fields.description === "string"
        ? null
        : fields.description
          ? adfToHtml(fields.description)
          : null,
    status: mapStatus(fields.status),
    assignee: mapUser(fields.assignee),
    reporter: mapUser(fields.reporter),
    priority: mapPriority(fields.priority),
    issueType: mapIssueType(fields.issuetype),
    labels: fields.labels ?? [],
    created: fields.created ?? "",
    updated: fields.updated ?? "",
    subtasks: (fields.subtasks ?? []).map((s: any) => mapIssueRef(s)!),
    children: [],
    parent: mapIssueRef(fields.parent),
    customFields: extractCustomFields(fields),
  };
}

function mapComment(raw: any): JiraComment {
  return {
    id: String(raw.id ?? ""),
    author: mapUser(raw.author),
    body: typeof raw.body === "string" ? raw.body : raw.body ? adfToText(raw.body) : "",
    bodyHtml: typeof raw.body === "string" ? null : raw.body ? adfToHtml(raw.body) : null,
    created: raw.created ?? "",
    updated: raw.updated ?? "",
  };
}

function mapFieldMeta(fieldId: string, raw: any): JiraFieldMeta {
  return {
    fieldId,
    name: raw.name ?? fieldId,
    required: raw.required ?? false,
    schema: {
      type: raw.schema?.type ?? "string",
      items: raw.schema?.items ?? undefined,
      custom: raw.schema?.custom ?? undefined,
      system: raw.schema?.system ?? undefined,
    },
    allowedValues: Array.isArray(raw.allowedValues)
      ? raw.allowedValues.map((v: any) => ({
          id: String(v.id ?? v.value ?? ""),
          name: v.name ?? v.value ?? undefined,
          value: v.value ?? undefined,
        }))
      : undefined,
    defaultValue: raw.defaultValue ?? undefined,
    autoCompleteUrl: raw.autoCompleteUrl ?? null,
  };
}

function mapProject(raw: any): JiraProject {
  return {
    id: String(raw.id ?? ""),
    key: raw.key ?? "",
    name: raw.name ?? "",
    avatarUrl: raw.avatarUrls?.["48x48"] ?? null,
    projectTypeKey: raw.projectTypeKey ?? "",
    favourite: raw.favourite ?? raw.isFavourite ?? false,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class JiraService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly encryptionKey: string,
  ) {}

  // -------------------------------------------------------------------------
  // Private: build an authenticated Version2Client for a given instance
  // -------------------------------------------------------------------------

  private async getClient(
    userId: string,
    instanceId: string,
  ): Promise<{ client: Version3Client; instance: JiraInstance }> {
    const instances = await this.listInstances(userId);
    const instance = instances.find((i) => i.id === instanceId);
    if (!instance) throw new Error("Jira instance not found");

    const tokensRow = await this.prisma.setting.findFirst({
      where: { userId, key: JIRA_TOKENS_SETTING_KEY },
    });
    const tokens: Record<string, string> =
      (tokensRow?.value as Record<string, string> | undefined) ?? {};
    const encrypted = tokens[instanceId];
    if (!encrypted) throw new Error("Jira token not found");

    const apiToken = decryptSecret(encrypted, this.encryptionKey);

    const authConfig = {
      host: instance.baseUrl,
      authentication: {
        basic: { email: instance.email, apiToken },
      },
    };

    const client = new Version3Client(authConfig);

    return { client, instance };
  }

  private async getAgileClient(
    userId: string,
    instanceId: string,
  ): Promise<{ client: AgileClient; instance: JiraInstance }> {
    const instances = await this.listInstances(userId);
    const instance = instances.find((i) => i.id === instanceId);
    if (!instance) throw new Error("Jira instance not found");

    const tokensRow = await this.prisma.setting.findFirst({
      where: { userId, key: JIRA_TOKENS_SETTING_KEY },
    });
    const tokens: Record<string, string> =
      (tokensRow?.value as Record<string, string> | undefined) ?? {};
    const encrypted = tokens[instanceId];
    if (!encrypted) throw new Error("Jira token not found");

    const apiToken = decryptSecret(encrypted, this.encryptionKey);

    const client = new AgileClient({
      host: instance.baseUrl,
      authentication: {
        basic: { email: instance.email, apiToken },
      },
    });

    return { client, instance };
  }

  // -------------------------------------------------------------------------
  // Instance management
  // -------------------------------------------------------------------------

  async listInstances(userId: string): Promise<JiraInstance[]> {
    const row = await this.prisma.setting.findFirst({
      where: { userId, key: JIRA_INSTANCES_SETTING_KEY },
    });
    return (row?.value as JiraInstance[] | undefined) ?? [];
  }

  async addInstance(
    userId: string,
    baseUrl: string,
    email: string,
    token: string,
    type: JiraInstanceType,
    name?: string,
  ): Promise<JiraInstance> {
    const normalizedUrl = baseUrl.replace(/\/+$/, "");

    // Validate credentials by calling myself endpoint
    const authConfig = {
      host: normalizedUrl,
      authentication: {
        basic: { email, apiToken: token },
      },
    };
    const testClient = new Version3Client(authConfig);
    await testClient.myself.getCurrentUser();

    const id = createId();
    const instance: JiraInstance = {
      id,
      name: name?.trim() || new URL(normalizedUrl).host,
      baseUrl: normalizedUrl,
      email,
      type,
    };

    const encryptedToken = encryptSecret(token, this.encryptionKey);

    const instancesRow = await this.prisma.setting.findFirst({
      where: { userId, key: JIRA_INSTANCES_SETTING_KEY },
    });
    const tokensRow = await this.prisma.setting.findFirst({
      where: { userId, key: JIRA_TOKENS_SETTING_KEY },
    });

    const instances: JiraInstance[] = (instancesRow?.value as JiraInstance[] | undefined) ?? [];
    const tokens: Record<string, string> =
      (tokensRow?.value as Record<string, string> | undefined) ?? {};

    instances.push(instance);
    tokens[id] = encryptedToken;

    await this.prisma.$transaction([
      instancesRow
        ? this.prisma.setting.update({
            where: { id: instancesRow.id },
            data: { value: instances as any },
          })
        : this.prisma.setting.create({
            data: {
              id: createId(),
              userId,
              key: JIRA_INSTANCES_SETTING_KEY,
              value: instances as any,
            },
          }),
      tokensRow
        ? this.prisma.setting.update({
            where: { id: tokensRow.id },
            data: { value: tokens as any },
          })
        : this.prisma.setting.create({
            data: {
              id: createId(),
              userId,
              key: JIRA_TOKENS_SETTING_KEY,
              value: tokens as any,
            },
          }),
    ]);

    return instance;
  }

  async removeInstance(userId: string, instanceId: string): Promise<void> {
    const instancesRow = await this.prisma.setting.findFirst({
      where: { userId, key: JIRA_INSTANCES_SETTING_KEY },
    });
    const tokensRow = await this.prisma.setting.findFirst({
      where: { userId, key: JIRA_TOKENS_SETTING_KEY },
    });

    const instances: JiraInstance[] = (instancesRow?.value as JiraInstance[] | undefined) ?? [];
    const tokens: Record<string, string> =
      (tokensRow?.value as Record<string, string> | undefined) ?? {};

    const filtered = instances.filter((i) => i.id !== instanceId);
    delete tokens[instanceId];

    const ops = [];
    if (instancesRow) {
      ops.push(
        this.prisma.setting.update({
          where: { id: instancesRow.id },
          data: { value: filtered as any },
        }),
      );
    }
    if (tokensRow) {
      ops.push(
        this.prisma.setting.update({
          where: { id: tokensRow.id },
          data: { value: tokens as any },
        }),
      );
    }
    if (ops.length > 0) {
      await this.prisma.$transaction(ops);
    }
  }

  async updateInstance(
    userId: string,
    instanceId: string,
    updates: {
      name?: string;
      baseUrl?: string;
      email?: string;
      token?: string;
      type?: JiraInstanceType;
    },
  ): Promise<JiraInstance> {
    const instancesRow = await this.prisma.setting.findFirst({
      where: { userId, key: JIRA_INSTANCES_SETTING_KEY },
    });
    const instances: JiraInstance[] = (instancesRow?.value as JiraInstance[] | undefined) ?? [];
    const idx = instances.findIndex((i) => i.id === instanceId);
    if (idx === -1) throw new Error("Jira instance not found");

    const current = instances[idx];
    const updatedInstance: JiraInstance = {
      ...current,
      name: updates.name?.trim() || current.name,
      baseUrl: updates.baseUrl ? updates.baseUrl.replace(/\/+$/, "") : current.baseUrl,
      email: updates.email || current.email,
      type: updates.type || current.type,
    };

    // If credentials changed, validate them
    if (updates.token || updates.email || updates.baseUrl) {
      const tokensRow = await this.prisma.setting.findFirst({
        where: { userId, key: JIRA_TOKENS_SETTING_KEY },
      });
      const tokens: Record<string, string> =
        (tokensRow?.value as Record<string, string> | undefined) ?? {};

      const currentToken = updates.token
        ? updates.token
        : decryptSecret(tokens[instanceId], this.encryptionKey);

      const testClient = new Version3Client({
        host: updatedInstance.baseUrl,
        authentication: {
          basic: { email: updatedInstance.email, apiToken: currentToken },
        },
      });
      await testClient.myself.getCurrentUser();

      // Update token if provided
      if (updates.token) {
        tokens[instanceId] = encryptSecret(updates.token, this.encryptionKey);
        if (tokensRow) {
          await this.prisma.setting.update({
            where: { id: tokensRow.id },
            data: { value: tokens as any },
          });
        }
      }
    }

    instances[idx] = updatedInstance;
    if (instancesRow) {
      await this.prisma.setting.update({
        where: { id: instancesRow.id },
        data: { value: instances as any },
      });
    }

    return updatedInstance;
  }

  async testConnection(userId: string, instanceId: string): Promise<{ displayName: string }> {
    const { client } = await this.getClient(userId, instanceId);
    const user = await client.myself.getCurrentUser();
    return { displayName: user.displayName ?? "" };
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  async getProjects(userId: string, instanceId: string): Promise<JiraProjectsResponse> {
    const { client } = await this.getClient(userId, instanceId);
    const result = await client.projects.searchProjects({ maxResults: 200, expand: "favourite" });
    return {
      projects: (result.values ?? []).map(mapProject),
    };
  }

  // -------------------------------------------------------------------------
  // Issues
  // -------------------------------------------------------------------------

  async getIssues(
    userId: string,
    instanceId: string,
    opts: {
      projectKey?: string;
      jql?: string;
      assignee?: string;
      watcher?: string;
      nextPageToken?: string;
      maxResults?: number;
    } = {},
  ): Promise<JiraIssuesResponse> {
    const { client } = await this.getClient(userId, instanceId);

    // Build JQL from opts when no explicit jql is provided
    let jql = opts.jql ?? "";
    if (!jql) {
      const clauses: string[] = [];
      if (opts.projectKey) clauses.push(`project = "${opts.projectKey}"`);
      if (opts.assignee) clauses.push(`assignee = "${opts.assignee}"`);
      if (opts.watcher) clauses.push(`watcher = "${opts.watcher}"`);
      jql =
        clauses.length > 0
          ? clauses.join(" AND ") + " ORDER BY updated DESC"
          : "ORDER BY updated DESC";
    }

    const result = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
      jql,
      nextPageToken: opts.nextPageToken,
      maxResults: opts.maxResults ?? 50,
      fields: [
        "summary",
        "description",
        "status",
        "assignee",
        "reporter",
        "priority",
        "issuetype",
        "labels",
        "created",
        "updated",
        "subtasks",
        "parent",
      ],
    });

    const mappedIssues = (result.issues ?? []).map(mapIssue);
    const rawToken = (result as any).nextPageToken ?? null;
    // Stop pagination when no results or fewer than requested
    const hasMore = mappedIssues.length >= (opts.maxResults ?? 50) && rawToken;

    return {
      issues: mappedIssues,
      total: (result as any).total ?? mappedIssues.length,
      nextPageToken: hasMore ? rawToken : null,
    };
  }

  // -------------------------------------------------------------------------
  // Issue detail
  // -------------------------------------------------------------------------

  async getIssue(
    userId: string,
    instanceId: string,
    issueKey: string,
  ): Promise<{ issue: JiraIssue; comments: JiraComment[] }> {
    const { client } = await this.getClient(userId, instanceId);
    const result = await client.issues.getIssue({
      issueIdOrKey: issueKey,
      fields: ["*all"],
    });
    const issue = mapIssue(result);
    const comments = ((result.fields as any)?.comment?.comments ?? []).map(mapComment);

    // If this is an epic, fetch child issues
    if (issue.issueType.name.toLowerCase() === "epic") {
      try {
        const childResult = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
          jql: `parent = "${issueKey}" ORDER BY rank ASC`,
          maxResults: 100,
          fields: ["summary", "status", "issuetype", "priority", "assignee"],
        });
        issue.children = (childResult.issues ?? []).map((child: any) => ({
          id: String(child.id ?? ""),
          key: child.key ?? "",
          summary: child.fields?.summary ?? "",
          status: mapStatus(child.fields?.status),
        }));
      } catch {
        // Epic children query failed — may not be supported on older Server instances
        issue.children = [];
      }
    }

    return { issue, comments };
  }

  async getCreateFieldsMeta(
    userId: string,
    instanceId: string,
    projectKey: string,
    issueTypeId: string,
  ): Promise<{ fields: JiraFieldMeta[] }> {
    const { client } = await this.getClient(userId, instanceId);
    const result = await client.issues.getCreateIssueMetaIssueTypeId({
      projectIdOrKey: projectKey,
      issueTypeId,
      maxResults: 200,
    });
    const allFields: any[] = result.fields ?? (result as any).values ?? [];
    const customFields: JiraFieldMeta[] = [];
    for (const raw of allFields) {
      const fieldId = raw.fieldId ?? raw.key ?? "";
      if (STANDARD_FIELD_IDS.has(fieldId)) continue;
      customFields.push(mapFieldMeta(fieldId, raw));
    }
    return { fields: customFields };
  }

  async createIssue(
    userId: string,
    instanceId: string,
    fields: {
      projectKey: string;
      issueTypeId: string;
      summary: string;
      description?: string;
      assigneeId?: string;
      priorityId?: string;
      labels?: string[];
      customFields?: Record<string, unknown>;
    },
  ): Promise<JiraIssue> {
    const { client } = await this.getClient(userId, instanceId);
    const issueFields: any = {
      project: { key: fields.projectKey },
      issuetype: { id: fields.issueTypeId },
      summary: fields.summary,
    };
    if (fields.description) issueFields.description = fields.description;
    if (fields.assigneeId) issueFields.assignee = { accountId: fields.assigneeId };
    if (fields.priorityId) issueFields.priority = { id: fields.priorityId };
    if (fields.labels && fields.labels.length > 0) issueFields.labels = fields.labels;
    if (fields.customFields) Object.assign(issueFields, prepareCustomFields(fields.customFields));

    const result = await client.issues.createIssue({ fields: issueFields });
    const created = await client.issues.getIssue({
      issueIdOrKey: result.key!,
      fields: [
        "summary",
        "description",
        "status",
        "assignee",
        "reporter",
        "priority",
        "issuetype",
        "labels",
        "created",
        "updated",
        "subtasks",
        "parent",
      ],
    });
    return mapIssue(created);
  }

  async updateIssue(
    userId: string,
    instanceId: string,
    issueKey: string,
    fields: {
      summary?: string;
      description?: string;
      assigneeId?: string;
      priorityId?: string;
      labels?: string[];
      customFields?: Record<string, unknown>;
    },
  ): Promise<void> {
    const { client } = await this.getClient(userId, instanceId);
    const update: any = { fields: {} };
    if (fields.summary !== undefined) update.fields.summary = fields.summary;
    if (fields.description !== undefined) update.fields.description = fields.description;
    if (fields.assigneeId !== undefined) update.fields.assignee = { accountId: fields.assigneeId };
    if (fields.priorityId !== undefined) update.fields.priority = { id: fields.priorityId };
    if (fields.labels !== undefined) update.fields.labels = fields.labels;
    if (fields.customFields) Object.assign(update.fields, prepareCustomFields(fields.customFields));
    await client.issues.editIssue({ issueIdOrKey: issueKey, ...update });
  }

  async getTransitions(
    userId: string,
    instanceId: string,
    issueKey: string,
  ): Promise<{ transitions: JiraTransition[] }> {
    const { client } = await this.getClient(userId, instanceId);
    const result = await client.issues.getTransitions({
      issueIdOrKey: issueKey,
      expand: "transitions.fields",
    });
    return {
      transitions: (result.transitions ?? []).map((t: any) => {
        const rawFields: Record<string, any> = t.fields ?? {};
        const allFieldIds = Object.keys(rawFields);
        if (allFieldIds.length > 0) {
          console.log(
            `[Jira] Transition "${t.name}" has fields:`,
            allFieldIds.map((id) => `${id} (required=${rawFields[id]?.required})`),
          );
        }
        const customFields: JiraFieldMeta[] = [];
        for (const [fieldId, meta] of Object.entries(rawFields)) {
          if (STANDARD_FIELD_IDS.has(fieldId)) continue;
          customFields.push(mapFieldMeta(fieldId, meta));
        }
        return {
          id: String(t.id ?? ""),
          name: t.name ?? "",
          to: mapStatus(t.to),
          fields: customFields.length > 0 ? customFields : undefined,
        };
      }),
    };
  }

  async transitionIssue(
    userId: string,
    instanceId: string,
    issueKey: string,
    transitionId: string,
    customFields?: Record<string, unknown>,
  ): Promise<void> {
    const { client } = await this.getClient(userId, instanceId);
    await client.issues.doTransition({
      issueIdOrKey: issueKey,
      transition: { id: transitionId },
      fields: customFields ? prepareCustomFields(customFields) : undefined,
    });
  }

  async addComment(
    userId: string,
    instanceId: string,
    issueKey: string,
    body: string,
  ): Promise<JiraComment> {
    const { client } = await this.getClient(userId, instanceId);
    const result = await client.issueComments.addComment({ issueIdOrKey: issueKey, comment: body });
    return mapComment(result);
  }

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  async searchUsers(
    userId: string,
    instanceId: string,
    query: string,
  ): Promise<{ users: JiraUser[] }> {
    const { client } = await this.getClient(userId, instanceId);
    const result = await client.userSearch.findUsers({ query, maxResults: 20 });
    return { users: (result ?? []).map(mapUser).filter((u): u is JiraUser => u !== null) };
  }

  async getPriorities(userId: string, instanceId: string): Promise<{ priorities: JiraPriority[] }> {
    const { client } = await this.getClient(userId, instanceId);
    const result = await client.issuePriorities.getPriorities();
    return {
      priorities: (result ?? []).map(mapPriority).filter((p): p is JiraPriority => p !== null),
    };
  }

  async getIssueTypes(
    userId: string,
    instanceId: string,
    projectKey: string,
  ): Promise<{ issueTypes: JiraIssueType[] }> {
    const { client } = await this.getClient(userId, instanceId);
    const project = await client.projects.getProject({ projectIdOrKey: projectKey });
    const result = await client.issueTypes.getIssueTypesForProject({
      projectId: Number(project.id),
    });
    return { issueTypes: (result ?? []).map(mapIssueType) };
  }

  async getLabels(userId: string, instanceId: string): Promise<{ labels: string[] }> {
    const { client } = await this.getClient(userId, instanceId);
    const result = await client.labels.getAllLabels({ maxResults: 1000 });
    return { labels: result.values ?? [] };
  }

  // -------------------------------------------------------------------------
  // Boards & Sprints (Agile API)
  // -------------------------------------------------------------------------

  async getBoards(
    userId: string,
    instanceId: string,
    projectKey?: string,
  ): Promise<{ boards: JiraBoard[] }> {
    const { client } = await this.getAgileClient(userId, instanceId);
    const result = await client.board.getAllBoards({
      projectKeyOrId: projectKey,
      maxResults: 100,
    });
    return {
      boards: (result.values ?? []).map((b: any) => ({
        id: b.id ?? 0,
        name: b.name ?? "",
        type: (b.type ?? "kanban") as JiraBoard["type"],
      })),
    };
  }

  async getBoardConfiguration(
    userId: string,
    instanceId: string,
    boardId: number,
  ): Promise<{ columns: JiraBoardColumn[] }> {
    const { client } = await this.getAgileClient(userId, instanceId);
    const result = await client.board.getConfiguration({ boardId });
    const columns = (result.columnConfig?.columns ?? []).map((col: any) => ({
      name: col.name ?? "",
      statuses: (col.statuses ?? []).map((s: any) => ({
        id: String(s.id ?? ""),
        name: "",
        statusCategory: "unknown" as const,
      })),
    }));
    return { columns };
  }

  async getSprints(
    userId: string,
    instanceId: string,
    boardId: number,
  ): Promise<{ sprints: JiraSprint[] }> {
    const { client } = await this.getAgileClient(userId, instanceId);
    const result = await client.board.getAllSprints({
      boardId,
      maxResults: 50,
      state: "active,future",
    });
    return {
      sprints: (result.values ?? []).map((s: any) => ({
        id: s.id ?? 0,
        name: s.name ?? "",
        state: s.state ?? "",
        startDate: s.startDate ?? null,
        endDate: s.endDate ?? null,
      })),
    };
  }

  async getSprintIssues(
    userId: string,
    instanceId: string,
    sprintId: number,
  ): Promise<JiraIssuesResponse> {
    const { client } = await this.getAgileClient(userId, instanceId);
    const result = await client.sprint.getIssuesForSprint({
      sprintId,
      maxResults: 200,
      fields: ["*all"],
    });
    return {
      issues: (result.issues ?? []).map(mapIssue),
      total: result.total ?? 0,
      nextPageToken: null,
    };
  }

  async getBoardIssues(
    userId: string,
    instanceId: string,
    boardId: number,
  ): Promise<JiraIssuesResponse> {
    const { client } = await this.getAgileClient(userId, instanceId);
    // For kanban boards (no sprint), fetch all issues on the board
    const result = await client.board.getIssuesForBoard({
      boardId,
      maxResults: 200,
      fields: ["*all"],
    });
    return {
      issues: ((result as any).issues ?? []).map(mapIssue),
      total: (result as any).total ?? 0,
      nextPageToken: null,
    };
  }
}
