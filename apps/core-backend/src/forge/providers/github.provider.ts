import type { Octokit } from "@octokit/rest";
import type { ForgeProvider } from "./forge-provider.interface";
import type {
  ForgeCounts,
  ForgeIssue,
  ForgeNotification,
  ForgePinnedItemStatus,
  ForgePullRequest,
  ForgePrSearchState,
  ForgeRepo,
  ForgeSavedSearch,
  Paged,
  PinnedItemRef,
} from "../forge.types";

const PER_PAGE = 30;
const SEARCH_PAGE_SIZE = 100;
const REPOS_PER_QUERY = 20;
const MAX_REPO_QUERY_LENGTH = 1500;

/** Split "owner/repo" on the first slash only (GitHub never nests further). */
function splitOwnerRepo(repo: string): { owner: string; name: string } {
  const idx = repo.indexOf("/");
  if (idx <= 0) return { owner: repo, name: "" };
  return { owner: repo.slice(0, idx), name: repo.slice(idx + 1) };
}

export class GithubProvider implements ForgeProvider {
  private cachedLogin: string | null = null;

  constructor(
    private readonly octokit: Octokit,
    private readonly apiBaseUrl: string,
  ) {
    void this.apiBaseUrl;
  }

  async validateToken(): Promise<{ username: string; avatarUrl?: string }> {
    const { data } = await this.octokit.rest.users.getAuthenticated();
    this.cachedLogin = data.login;
    return { username: data.login, avatarUrl: data.avatar_url };
  }

  private async login(): Promise<string> {
    if (this.cachedLogin) return this.cachedLogin;
    const { data } = await this.octokit.rest.users.getAuthenticated();
    this.cachedLogin = data.login;
    return data.login;
  }

  async getCounts(): Promise<ForgeCounts> {
    const me = await this.login();
    const [myPRs, reviewing, assigned, notifs] = await Promise.all([
      this.octokit.rest.search.issuesAndPullRequests({
        q: `is:open is:pr author:${me} archived:false`,
        per_page: 1,
      }),
      this.octokit.rest.search.issuesAndPullRequests({
        q: `is:open is:pr review-requested:${me} archived:false`,
        per_page: 1,
      }),
      this.octokit.rest.search.issuesAndPullRequests({
        q: `is:open is:issue assignee:${me} archived:false`,
        per_page: 1,
      }),
      this.octokit.rest.activity
        .listNotificationsForAuthenticatedUser({ per_page: 50 })
        .catch(() => ({ data: [] as unknown[] })),
    ]);
    return {
      myPRs: myPRs.data.total_count,
      reviewing: reviewing.data.total_count,
      assignedIssues: assigned.data.total_count,
      notifications: notifs.data.length,
    };
  }

  async listMyPullRequests(cursor?: string): Promise<Paged<ForgePullRequest>> {
    const me = await this.login();
    return this.searchPRs(`is:open is:pr author:${me} archived:false`, cursor);
  }

  async listReviewRequests(cursor?: string): Promise<Paged<ForgePullRequest>> {
    const me = await this.login();
    return this.searchPRs(`is:open is:pr review-requested:${me} archived:false`, cursor);
  }

  async listAssignedIssues(cursor?: string): Promise<Paged<ForgeIssue>> {
    const me = await this.login();
    return this.searchIssues(`is:open is:issue assignee:${me} archived:false`, cursor);
  }

  async listNotifications(cursor?: string): Promise<Paged<ForgeNotification>> {
    const page = cursor ? Number(cursor) : 1;
    let data: any[] = [];
    try {
      const resp = await this.octokit.rest.activity.listNotificationsForAuthenticatedUser({
        per_page: PER_PAGE,
        page,
      });
      data = resp.data;
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e?.status === 403) {
        // Token lacks `notifications` scope. Throw a tagged error so the
        // route layer maps to FORGE_SCOPE_MISSING and the UI can guide the user.
        throw Object.assign(new Error("Token is missing the notifications scope"), {
          status: 403,
          message: "Token is missing the notifications scope",
        });
      }
      throw err;
    }
    const items: ForgeNotification[] = data.map((n) => ({
      id: n.id,
      title: n.subject.title,
      repo: n.repository.full_name,
      provider: "github" as const,
      reason: mapNotificationReason(n.reason),
      updatedAt: n.updated_at,
      webUrl: subjectWebUrl(n),
      unread: n.unread,
      kind: mapNotificationKind(n.subject.type),
    }));
    return { items, nextCursor: items.length === PER_PAGE ? String(page + 1) : null };
  }

  async listRepos(cursor?: string): Promise<Paged<ForgeRepo>> {
    const page = cursor ? Number(cursor) : 1;
    const { data } = await this.octokit.rest.repos.listForAuthenticatedUser({
      per_page: PER_PAGE,
      page,
      affiliation: "owner,collaborator,organization_member",
      sort: "updated",
    });
    const items: ForgeRepo[] = data.map((r) => ({
      id: String(r.id),
      fullName: r.full_name,
      provider: "github" as const,
      webUrl: r.html_url,
      description: r.description ?? undefined,
      language: r.language ?? undefined,
      isPrivate: r.private,
      updatedAt: r.updated_at ?? r.pushed_at ?? new Date().toISOString(),
    }));
    return { items, nextCursor: items.length === PER_PAGE ? String(page + 1) : null };
  }

  async listRepoPullRequests(
    repo: string,
    cursor?: string,
    query?: string,
  ): Promise<Paged<ForgePullRequest>> {
    if (query) {
      return this.searchPRs(
        `${JSON.stringify(query)} in:title,body is:pr is:open repo:${repo}`,
        cursor,
      );
    }
    const { owner, name } = splitOwnerRepo(repo);
    const page = cursor ? Number(cursor) : 1;
    const { data } = await this.octokit.rest.pulls.list({
      owner,
      repo: name,
      state: "open",
      per_page: PER_PAGE,
      page,
    });
    const items: ForgePullRequest[] = data.map((pr) => ({
      id: String(pr.id),
      number: pr.number,
      title: pr.title,
      repo,
      provider: "github" as const,
      state: pr.draft ? ("draft" as const) : ("open" as const),
      reviewState: "none" as const,
      author: pr.user ? { login: pr.user.login, avatarUrl: pr.user.avatar_url } : null,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      webUrl: pr.html_url,
      draft: Boolean(pr.draft),
    }));
    return { items, nextCursor: items.length === PER_PAGE ? String(page + 1) : null };
  }

  async searchPullRequests(
    query: string,
    state: ForgePrSearchState,
    cursor?: string,
  ): Promise<Paged<ForgePullRequest>> {
    const page = cursor ? Number(cursor) : 1;
    const needed = page * PER_PAGE;
    const repoNames: string[] = [];
    for (let repoPage = 1; ; repoPage++) {
      const { data } = await this.octokit.rest.repos.listForAuthenticatedUser({
        per_page: SEARCH_PAGE_SIZE,
        page: repoPage,
        affiliation: "owner,collaborator,organization_member",
      });
      repoNames.push(...data.map((repo) => repo.full_name));
      if (data.length < SEARCH_PAGE_SIZE) break;
    }
    if (repoNames.length === 0) return { items: [], nextCursor: null };

    // Every search is explicitly scoped to the account's repositories. A bare
    // GitHub search would otherwise include unrelated public pull requests.
    const groups: string[][] = [];
    for (const repo of repoNames.sort()) {
      const last = groups.at(-1);
      const qualifierLength = ` repo:${repo}`.length;
      if (
        !last ||
        last.length === REPOS_PER_QUERY ||
        last.reduce((length, name) => length + ` repo:${name}`.length, 0) + qualifierLength >
          MAX_REPO_QUERY_LENGTH
      ) {
        groups.push([repo]);
      } else {
        last.push(repo);
      }
    }

    const stateQualifier =
      state === "open"
        ? "is:open"
        : state === "merged"
          ? "is:merged"
          : state === "closed"
            ? "is:closed is:unmerged"
            : "";
    const results: ForgePullRequest[] = [];
    let total = 0;
    // Fetch the same prefix from each group, then merge it. Any item beyond
    // that prefix cannot precede the requested global page.
    for (const group of groups) {
      const q = `${JSON.stringify(query)} in:title,body is:pr ${stateQualifier} ${group.map((repo) => `repo:${repo}`).join(" ")}`;
      const groupItems: ForgePullRequest[] = [];
      let groupTotal = 0;
      for (let searchPage = 1; groupItems.length < needed; searchPage++) {
        const { data } = await this.octokit.rest.search.issuesAndPullRequests({
          q,
          sort: "updated",
          order: "desc",
          per_page: SEARCH_PAGE_SIZE,
          page: searchPage,
        });
        groupTotal = Math.min(data.total_count, 1000);
        groupItems.push(...data.items.map((item) => this.normalizeSearchPR(item, state)));
        if (data.items.length < SEARCH_PAGE_SIZE || searchPage * SEARCH_PAGE_SIZE >= groupTotal)
          break;
      }
      total += groupTotal;
      results.push(...groupItems);
    }
    results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    const start = (page - 1) * PER_PAGE;
    return {
      items: results.slice(start, needed),
      nextCursor: needed < total ? String(page + 1) : null,
    };
  }

  async listRepoIssues(repo: string, cursor?: string): Promise<Paged<ForgeIssue>> {
    const { owner, name } = splitOwnerRepo(repo);
    const page = cursor ? Number(cursor) : 1;
    const { data } = await this.octokit.rest.issues.listForRepo({
      owner,
      repo: name,
      state: "open",
      per_page: PER_PAGE,
      page,
    });
    const items: ForgeIssue[] = data
      .filter((i) => !i.pull_request)
      .map((i) => ({
        id: String(i.id),
        number: i.number,
        title: i.title,
        repo,
        provider: "github" as const,
        state: i.state === "closed" ? ("closed" as const) : ("open" as const),
        author: i.user ? { login: i.user.login, avatarUrl: i.user.avatar_url } : null,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        webUrl: i.html_url,
        labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
      }));
    return { items, nextCursor: items.length === PER_PAGE ? String(page + 1) : null };
  }

  async searchSaved(
    query: ForgeSavedSearch,
    cursor?: string,
  ): Promise<Paged<ForgePullRequest | ForgeIssue>> {
    if (query.kind === "pr") return this.searchPRs(query.query, cursor);
    return this.searchIssues(query.query, cursor);
  }

  async getPinnedItemStatus(items: PinnedItemRef[]): Promise<ForgePinnedItemStatus[]> {
    const checkedAt = new Date().toISOString();
    const results: ForgePinnedItemStatus[] = [];
    for (const ref of items) {
      const { owner, name } = splitOwnerRepo(ref.repo);
      try {
        if (ref.kind === "pr") {
          const { data } = await this.octokit.rest.pulls.get({
            owner,
            repo: name,
            pull_number: ref.number,
          });
          results.push({
            pinId: ref.pinId,
            state: data.merged
              ? "merged"
              : data.draft
                ? "draft"
                : data.state === "open"
                  ? "open"
                  : "closed",
            reviewState: "none",
            checkedAt,
          });
        } else {
          const { data } = await this.octokit.rest.issues.get({
            owner,
            repo: name,
            issue_number: ref.number,
          });
          results.push({
            pinId: ref.pinId,
            state: data.state === "closed" ? "closed" : "open",
            checkedAt,
          });
        }
      } catch {
        // skip unfetchable
      }
    }
    return results;
  }

  async fetchItemDetails(
    kind: "pr" | "issue",
    repo: string,
    number: number,
  ): Promise<{ title: string; webUrl: string }> {
    const { owner, name } = splitOwnerRepo(repo);
    if (kind === "pr") {
      const { data } = await this.octokit.rest.pulls.get({
        owner,
        repo: name,
        pull_number: number,
      });
      return { title: data.title, webUrl: data.html_url };
    }
    const { data } = await this.octokit.rest.issues.get({
      owner,
      repo: name,
      issue_number: number,
    });
    return { title: data.title, webUrl: data.html_url };
  }

  // ---- internal ----

  private async searchPRs(q: string, cursor?: string): Promise<Paged<ForgePullRequest>> {
    const page = cursor ? Number(cursor) : 1;
    const { data } = await this.octokit.rest.search.issuesAndPullRequests({
      q,
      per_page: PER_PAGE,
      page,
    });
    const items: ForgePullRequest[] = data.items.map((it) => this.normalizeSearchPR(it));
    const more = items.length === PER_PAGE && page * PER_PAGE < data.total_count;
    return { items, nextCursor: more ? String(page + 1) : null };
  }

  private normalizeSearchPR(it: any, searchState?: ForgePrSearchState): ForgePullRequest {
    const repo = (it.repository_url ?? "").split("/repos/").at(-1) ?? "";
    return {
      id: String(it.id),
      number: it.number,
      title: it.title,
      repo,
      provider: "github",
      state:
        it.draft && it.state === "open"
          ? "draft"
          : searchState === "merged" || it.pull_request?.merged_at
            ? "merged"
            : it.state === "closed"
              ? "closed"
              : "open",
      reviewState: "none",
      author: it.user ? { login: it.user.login, avatarUrl: it.user.avatar_url } : null,
      createdAt: it.created_at,
      updatedAt: it.updated_at,
      webUrl: it.html_url,
      draft: Boolean(it.draft),
    };
  }

  private async searchIssues(q: string, cursor?: string): Promise<Paged<ForgeIssue>> {
    const page = cursor ? Number(cursor) : 1;
    const { data } = await this.octokit.rest.search.issuesAndPullRequests({
      q,
      per_page: PER_PAGE,
      page,
    });
    const items: ForgeIssue[] = data.items.map((it) => {
      const repo = (it.repository_url ?? "").replace("https://api.github.com/repos/", "");
      return {
        id: String(it.id),
        number: it.number,
        title: it.title,
        repo,
        provider: "github" as const,
        state: it.state === "closed" ? ("closed" as const) : ("open" as const),
        author: it.user ? { login: it.user.login, avatarUrl: it.user.avatar_url } : null,
        createdAt: it.created_at,
        updatedAt: it.updated_at,
        webUrl: it.html_url,
        labels: (it.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
      };
    });
    const more = items.length === PER_PAGE && page * PER_PAGE < data.total_count;
    return { items, nextCursor: more ? String(page + 1) : null };
  }
}

function mapNotificationReason(r: string): ForgeNotification["reason"] {
  switch (r) {
    case "review_requested":
      return "review_requested";
    case "mention":
      return "mention";
    case "assign":
      return "assign";
    case "author":
      return "author";
    case "comment":
      return "comment";
    case "subscribed":
      return "subscribed";
    default:
      return "other";
  }
}

function mapNotificationKind(t: string): ForgeNotification["kind"] {
  switch (t) {
    case "PullRequest":
      return "pr";
    case "Issue":
      return "issue";
    case "Discussion":
      return "discussion";
    case "Commit":
      return "commit";
    default:
      return "other";
  }
}

function subjectWebUrl(n: {
  subject: { url: string | null; type: string };
  repository: { html_url: string };
}): string {
  const apiUrl = n.subject.url ?? "";
  if (!apiUrl) return n.repository.html_url;
  return apiUrl
    .replace("https://api.github.com/repos/", "https://github.com/")
    .replace("/pulls/", "/pull/");
}
