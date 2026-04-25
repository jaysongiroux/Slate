import type {
  ForgeCounts,
  ForgeInstance,
  ForgeIssue,
  ForgeNotification,
  ForgePinnedItem,
  ForgePinnedItemStatus,
  ForgePullRequest,
  ForgeRepo,
  ForgeSavedSearch,
  Paged,
} from "@slate/shared";

export type {
  ForgeCounts,
  ForgeInstance,
  ForgeIssue,
  ForgeNotification,
  ForgePinnedItem,
  ForgePinnedItemStatus,
  ForgePullRequest,
  ForgeRepo,
  ForgeSavedSearch,
  Paged,
};

export interface ForgeRateLimitInfo {
  remaining: number;
  limit: number;
  /** Epoch seconds. */
  resetAt: number;
}

export interface PinnedItemRef {
  pinId: string;
  kind: "pr" | "issue";
  repo: string;
  number: number;
}

export interface AddForgeInstanceInput {
  name?: string;
  provider: "github" | "gitlab";
  baseUrl: string;
  token: string;
}
