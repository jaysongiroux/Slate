/** How often we pull remote document events when there is no local dirty work. */
export const PULL_INTERVAL_MS = 90_000;

/** How often we scan the workspace (hash / stat) for missed filesystem changes. */
export const DISK_RECONCILE_INTERVAL_MS = 90_000;
