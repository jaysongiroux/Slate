import type { ForgeProvider } from "./forge-provider.interface";
import type {
  ForgeCounts,
  ForgeIssue,
  ForgeNotification,
  ForgePinnedItemStatus,
  ForgePullRequest,
  ForgeRepo,
  ForgeSavedSearch,
  Paged,
  PinnedItemRef,
} from "../forge.types";

const PER_PAGE = 30;

// Gitbeaker's type surface is complex; we type the injected client loosely and cast.
type GitlabLike = {
  Users: { showCurrentUser: (...args: any[]) => Promise<any> };
  MergeRequests: { all: (...args: any[]) => Promise<any[]>; show: (...args: any[]) => Promise<any> };
  Issues: { all: (...args: any[]) => Promise<any[]>; show: (...args: any[]) => Promise<any> };
  Projects: { all: (...args: any[]) => Promise<any[]> };
  TodoLists: { all: (...args: any[]) => Promise<any[]> };
};

export class GitlabProvider implements ForgeProvider {
  private cachedUser: { id: number; username: string; avatarUrl?: string } | null = null;

  constructor(
    private readonly api: GitlabLike,
    private readonly apiBaseUrl: string,
  ) {
    void this.apiBaseUrl;
  }

  async validateToken(): Promise<{ username: string; avatarUrl?: string }> {
    const user = await this.api.Users.showCurrentUser();
    this.cachedUser = {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatar_url ?? undefined,
    };
    return { username: user.username, avatarUrl: user.avatar_url ?? undefined };
  }

  private async me() {
    if (this.cachedUser) return this.cachedUser;
    await this.validateToken();
    return this.cachedUser!;
  }

  async getCounts(): Promise<ForgeCounts> {
    const me = await this.me();
    const [mine, reviewing, assigned, todos] = await Promise.all([
      this.api.MergeRequests.all({ state: "opened", authorId: me.id, perPage: 1 }),
      this.api.MergeRequests.all({ state: "opened", reviewerId: me.id, perPage: 1 }),
      this.api.Issues.all({ state: "opened", assigneeId: me.id, perPage: 1 }),
      this.api.TodoLists.all({ state: "pending", perPage: 1 }).catch(() => [] as any[]),
    ]);
    return {
      myPRs: mine.length,
      reviewing: reviewing.length,
      assignedIssues: assigned.length,
      notifications: todos.length,
    };
  }

  async listMyPullRequests(cursor?: string): Promise<Paged<ForgePullRequest>> {
    const me = await this.me();
    const page = cursor ? Number(cursor) : 1;
    const mrs = await this.api.MergeRequests.all({
      state: "opened",
      authorId: me.id,
      perPage: PER_PAGE,
      page,
      orderBy: "updated_at",
    });
    return this.normalizeMRs(mrs, page);
  }

  async listReviewRequests(cursor?: string): Promise<Paged<ForgePullRequest>> {
    const me = await this.me();
    const page = cursor ? Number(cursor) : 1;
    const mrs = await this.api.MergeRequests.all({
      state: "opened",
      reviewerId: me.id,
      perPage: PER_PAGE,
      page,
      orderBy: "updated_at",
    });
    return this.normalizeMRs(mrs, page);
  }

  async listAssignedIssues(cursor?: string): Promise<Paged<ForgeIssue>> {
    const me = await this.me();
    const page = cursor ? Number(cursor) : 1;
    const issues = await this.api.Issues.all({
      state: "opened",
      assigneeId: me.id,
      perPage: PER_PAGE,
      page,
      orderBy: "updated_at",
    });
    return this.normalizeIssues(issues, page);
  }

  async listNotifications(cursor?: string): Promise<Paged<ForgeNotification>> {
    const page = cursor ? Number(cursor) : 1;
    const todos = await this.api.TodoLists.all({
      state: "pending",
      perPage: PER_PAGE,
      page,
    }).catch(() => [] as any[]);
    const items: ForgeNotification[] = todos.map((t: any) => ({
      id: String(t.id),
      title: t.body ?? t.target?.title ?? "Todo",
      repo: t.project?.path_with_namespace ?? "",
      provider: "gitlab" as const,
      reason: mapTodoAction(t.action_name),
      updatedAt: t.updated_at ?? t.created_at,
      webUrl: t.target_url,
      unread: t.state === "pending",
      kind: mapTodoTargetType(t.target_type),
    }));
    return { items, nextCursor: items.length === PER_PAGE ? String(page + 1) : null };
  }

  async listRepos(cursor?: string): Promise<Paged<ForgeRepo>> {
    const page = cursor ? Number(cursor) : 1;
    const projects = await this.api.Projects.all({
      membership: true,
      perPage: PER_PAGE,
      page,
      orderBy: "last_activity_at",
    });
    const items: ForgeRepo[] = projects.map((p: any) => ({
      id: String(p.id),
      fullName: p.path_with_namespace,
      provider: "gitlab" as const,
      webUrl: p.web_url,
      description: p.description ?? undefined,
      language: undefined,
      isPrivate: p.visibility !== "public",
      updatedAt: p.last_activity_at ?? p.updated_at,
    }));
    return { items, nextCursor: items.length === PER_PAGE ? String(page + 1) : null };
  }

  async listRepoPullRequests(repo: string, cursor?: string): Promise<Paged<ForgePullRequest>> {
    const page = cursor ? Number(cursor) : 1;
    const mrs = await this.api.MergeRequests.all({
      projectId: encodeURIComponent(repo),
      state: "opened",
      perPage: PER_PAGE,
      page,
      orderBy: "updated_at",
    });
    return this.normalizeMRs(mrs, page);
  }

  async listRepoIssues(repo: string, cursor?: string): Promise<Paged<ForgeIssue>> {
    const page = cursor ? Number(cursor) : 1;
    const issues = await this.api.Issues.all({
      projectId: encodeURIComponent(repo),
      state: "opened",
      perPage: PER_PAGE,
      page,
      orderBy: "updated_at",
    });
    return this.normalizeIssues(issues, page);
  }

  async searchSaved(
    query: ForgeSavedSearch,
    cursor?: string,
  ): Promise<Paged<ForgePullRequest | ForgeIssue>> {
    const extra = parseFilterString(query.query);
    const page = cursor ? Number(cursor) : 1;
    if (query.kind === "pr") {
      const mrs = await this.api.MergeRequests.all({
        ...extra,
        perPage: PER_PAGE,
        page,
      });
      return this.normalizeMRs(mrs, page) as unknown as Paged<ForgePullRequest | ForgeIssue>;
    }
    const issues = await this.api.Issues.all({
      ...extra,
      perPage: PER_PAGE,
      page,
    });
    return this.normalizeIssues(issues, page) as unknown as Paged<ForgePullRequest | ForgeIssue>;
  }

  async getPinnedItemStatus(items: PinnedItemRef[]): Promise<ForgePinnedItemStatus[]> {
    const checkedAt = new Date().toISOString();
    const results: ForgePinnedItemStatus[] = [];
    for (const ref of items) {
      try {
        if (ref.kind === "pr") {
          const mr = await this.api.MergeRequests.show(
            encodeURIComponent(ref.repo),
            ref.number,
          );
          results.push({
            pinId: ref.pinId,
            state:
              mr.state === "merged"
                ? "merged"
                : mr.draft
                  ? "draft"
                  : mr.state === "opened"
                    ? "open"
                    : "closed",
            reviewState: "none",
            checkedAt,
          });
        } else {
          const issue = await this.api.Issues.show(encodeURIComponent(ref.repo), ref.number);
          results.push({
            pinId: ref.pinId,
            state: issue.state === "closed" ? "closed" : "open",
            checkedAt,
          });
        }
      } catch {
        // skip
      }
    }
    return results;
  }

  async fetchItemDetails(
    kind: "pr" | "issue",
    repo: string,
    number: number,
  ): Promise<{ title: string; webUrl: string }> {
    if (kind === "pr") {
      const mr = await this.api.MergeRequests.show(encodeURIComponent(repo), number);
      return { title: mr.title, webUrl: mr.web_url };
    }
    const issue = await this.api.Issues.show(encodeURIComponent(repo), number);
    return { title: issue.title, webUrl: issue.web_url };
  }

  // ---- internal ----

  private normalizeMRs(mrs: any[], page: number): Paged<ForgePullRequest> {
    const items: ForgePullRequest[] = mrs.map((mr) => ({
      id: String(mr.id),
      number: mr.iid,
      title: mr.title,
      repo: (mr.references?.full ?? "").split("!")[0] || "",
      provider: "gitlab" as const,
      state:
        mr.state === "merged"
          ? ("merged" as const)
          : mr.draft
            ? ("draft" as const)
            : mr.state === "opened"
              ? ("open" as const)
              : ("closed" as const),
      reviewState: "none" as const,
      author: mr.author
        ? { login: mr.author.username, avatarUrl: mr.author.avatar_url ?? undefined }
        : null,
      createdAt: mr.created_at,
      updatedAt: mr.updated_at,
      webUrl: mr.web_url,
      draft: Boolean(mr.draft),
    }));
    return { items, nextCursor: items.length === PER_PAGE ? String(page + 1) : null };
  }

  private normalizeIssues(issues: any[], page: number): Paged<ForgeIssue> {
    const items: ForgeIssue[] = issues.map((i) => ({
      id: String(i.id),
      number: i.iid,
      title: i.title,
      repo: (i.references?.full ?? "").split("#")[0] || "",
      provider: "gitlab" as const,
      state: i.state === "closed" ? ("closed" as const) : ("open" as const),
      author: i.author
        ? { login: i.author.username, avatarUrl: i.author.avatar_url ?? undefined }
        : null,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      webUrl: i.web_url,
      labels: i.labels ?? [],
    }));
    return { items, nextCursor: items.length === PER_PAGE ? String(page + 1) : null };
  }
}

function mapTodoAction(a: string): ForgeNotification["reason"] {
  switch (a) {
    case "review_requested":
      return "review_requested";
    case "mentioned":
    case "directly_addressed":
      return "mention";
    case "assigned":
      return "assign";
    case "marked":
      return "subscribed";
    default:
      return "other";
  }
}

function mapTodoTargetType(t: string): ForgeNotification["kind"] {
  switch (t) {
    case "MergeRequest":
      return "pr";
    case "Issue":
      return "issue";
    default:
      return "other";
  }
}

function parseFilterString(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of s.split("&")) {
    const [k, v] = pair.split("=");
    if (k && v != null) out[k.trim()] = decodeURIComponent(v.trim());
  }
  return out;
}
