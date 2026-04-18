/** Settings key for the Jira extension toggle (syncs to desktop). */
export const JIRA_ENABLED_SETTING_KEY = "extensions.jiraEnabled";

/** Settings key for instance metadata: [{id, name, baseUrl, email, type}] (syncs to desktop). */
export const JIRA_INSTANCES_SETTING_KEY = "jira.instances";

/** Settings key for encrypted tokens: {[instanceId]: ciphertext} (server-only, never replicated). */
export const JIRA_TOKENS_SETTING_KEY = "jira.tokens";

/** Settings key for saved JQL queries: [{id, name, jql, instanceId}] (syncs to desktop). */
export const JIRA_SAVED_QUERIES_SETTING_KEY = "jira.savedQueries";

export type JiraInstanceType = "cloud" | "server";

export interface JiraInstance {
  id: string;
  name: string;
  baseUrl: string;
  email: string;
  type: JiraInstanceType;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  avatarUrl: string | null;
  projectTypeKey: string;
  favourite: boolean;
}

export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  description: string | null;
  descriptionHtml: string | null;
  status: JiraStatus;
  assignee: JiraUser | null;
  reporter: JiraUser | null;
  priority: JiraPriority | null;
  issueType: JiraIssueType;
  labels: string[];
  created: string;
  updated: string;
  subtasks: JiraIssueRef[];
  children: JiraIssueRef[];
  parent: JiraIssueRef | null;
  customFields: Record<string, unknown>;
}

export interface JiraIssueRef {
  id: string;
  key: string;
  summary: string;
  status: JiraStatus;
}

export interface JiraStatus {
  id: string;
  name: string;
  statusCategory: "todo" | "in_progress" | "done" | "unknown";
}

export interface JiraFieldAllowedValue {
  id: string;
  name?: string;
  value?: string;
}

export interface JiraFieldMeta {
  fieldId: string;
  name: string;
  required: boolean;
  schema: { type: string; items?: string; custom?: string; system?: string };
  allowedValues?: JiraFieldAllowedValue[];
  defaultValue?: unknown;
  autoCompleteUrl?: string | null;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: JiraStatus;
  fields?: JiraFieldMeta[];
}

export interface JiraComment {
  id: string;
  author: JiraUser | null;
  body: string;
  bodyHtml: string | null;
  created: string;
  updated: string;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
}

export interface JiraBoard {
  id: number;
  name: string;
  type: "scrum" | "kanban" | "simple";
}

export interface JiraBoardColumn {
  name: string;
  statuses: JiraStatus[];
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  avatarUrl: string | null;
  emailAddress: string | null;
}

export interface JiraPriority {
  id: string;
  name: string;
  iconUrl: string | null;
}

export interface JiraIssueType {
  id: string;
  name: string;
  iconUrl: string | null;
  subtask: boolean;
}

export interface SavedJqlQuery {
  id: string;
  name: string;
  jql: string;
  instanceId: string;
}

export interface JiraProjectsResponse {
  projects: JiraProject[];
}

export interface JiraIssuesResponse {
  issues: JiraIssue[];
  total: number;
  nextPageToken: string | null;
}
