/** Settings keys (replicated to desktop except for tokens). */
export const FORGE_INSTANCES_SETTING_KEY = "forge.instances";
/** Encrypted tokens — server-only, NEVER replicated. */
export const FORGE_TOKENS_SETTING_KEY = "forge.tokens";
export const FORGE_STARRED_REPOS_SETTING_KEY = "forge.starredRepos";
export const FORGE_PINNED_ITEMS_SETTING_KEY = "forge.pinnedItems";
export const FORGE_SAVED_SEARCHES_SETTING_KEY = "forge.savedSearches";

export type ForgeProviderKind = "github" | "gitlab";

export interface ForgeInstance {
  id: string;
  name: string;
  provider: ForgeProviderKind;
  baseUrl: string;
  username?: string;
  avatarUrl?: string;
}

export interface ForgeRepo {
  id: string;
  fullName: string;
  provider: ForgeProviderKind;
  webUrl: string;
  description?: string;
  language?: string;
  isPrivate: boolean;
  updatedAt: string;
}

export type ForgePrState = "open" | "draft" | "merged" | "closed";
export type ForgePrSearchState = "all" | "open" | "merged" | "closed";
export type ForgeReviewState = "none" | "approved" | "changes_requested" | "commented" | "pending";

export interface ForgePullRequest {
  id: string;
  number: number;
  title: string;
  repo: string;
  provider: ForgeProviderKind;
  state: ForgePrState;
  reviewState: ForgeReviewState;
  author: { login: string; avatarUrl?: string } | null;
  createdAt: string;
  updatedAt: string;
  webUrl: string;
  draft: boolean;
}

export type ForgeIssueState = "open" | "closed";

export interface ForgeIssue {
  id: string;
  number: number;
  title: string;
  repo: string;
  provider: ForgeProviderKind;
  state: ForgeIssueState;
  author: { login: string; avatarUrl?: string } | null;
  createdAt: string;
  updatedAt: string;
  webUrl: string;
  labels: string[];
}

export type ForgeNotificationReason =
  | "review_requested"
  | "mention"
  | "assign"
  | "author"
  | "comment"
  | "subscribed"
  | "other";

export interface ForgeNotification {
  id: string;
  title: string;
  repo: string;
  provider: ForgeProviderKind;
  reason: ForgeNotificationReason;
  updatedAt: string;
  webUrl: string;
  unread: boolean;
  kind: "pr" | "issue" | "discussion" | "commit" | "other";
}

export interface ForgeCounts {
  myPRs: number;
  reviewing: number;
  notifications: number;
  assignedIssues: number;
}

export interface ForgePinnedItem {
  id: string;
  instanceId: string;
  kind: "pr" | "issue";
  repo: string;
  number: number;
  title: string;
  webUrl: string;
  pinnedAt: string;
}

export interface ForgePinnedItemStatus {
  pinId: string;
  state: ForgePrState | ForgeIssueState;
  reviewState?: ForgeReviewState;
  checkedAt: string;
}

export interface ForgeSavedSearch {
  id: string;
  instanceId: string;
  name: string;
  kind: "pr" | "issue";
  /** Provider-native query (GitHub qualifier string, or GitLab filter-param string). */
  query: string;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

/** Error codes returned by /api/forge/* routes. */
export type ForgeErrorCode =
  | "FORGE_INVALID_QUERY"
  | "FORGE_TOKEN_INVALID"
  | "FORGE_RATE_LIMITED"
  | "FORGE_UNREACHABLE"
  | "FORGE_SCOPE_MISSING"
  | "FORGE_NOT_FOUND";

export interface ForgeErrorBody {
  error: ForgeErrorCode;
  message: string;
  /** ISO timestamp for FORGE_RATE_LIMITED. */
  resetAt?: string;
}
