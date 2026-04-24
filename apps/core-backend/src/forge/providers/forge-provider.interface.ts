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

export interface ForgeProvider {
  validateToken(): Promise<{ username: string; avatarUrl?: string }>;
  getCounts(): Promise<ForgeCounts>;
  listMyPullRequests(cursor?: string): Promise<Paged<ForgePullRequest>>;
  listReviewRequests(cursor?: string): Promise<Paged<ForgePullRequest>>;
  listNotifications(cursor?: string): Promise<Paged<ForgeNotification>>;
  listAssignedIssues(cursor?: string): Promise<Paged<ForgeIssue>>;
  listRepos(cursor?: string): Promise<Paged<ForgeRepo>>;
  listRepoPullRequests(repo: string, cursor?: string): Promise<Paged<ForgePullRequest>>;
  listRepoIssues(repo: string, cursor?: string): Promise<Paged<ForgeIssue>>;
  searchSaved(
    query: ForgeSavedSearch,
    cursor?: string,
  ): Promise<Paged<ForgePullRequest | ForgeIssue>>;
  getPinnedItemStatus(items: PinnedItemRef[]): Promise<ForgePinnedItemStatus[]>;
  /** Enrich a pin at creation time (fetch title and web URL). */
  fetchItemDetails(
    kind: "pr" | "issue",
    repo: string,
    number: number,
  ): Promise<{ title: string; webUrl: string }>;
}
