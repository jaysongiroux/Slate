export const SIDEBAR_WIDTH_STORAGE_KEY = "slate.desktop.sidebar-width";
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "slate.desktop.sidebar-collapsed";

export function readStoredSidebarWidth(
  storage: Storage | undefined,
  defaultWidth: number,
  minWidth: number,
  maxWidth: number,
): number {
  const stored = storage?.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  const width = stored ? Number(stored) : defaultWidth;
  if (!Number.isFinite(width)) return defaultWidth;
  return Math.min(maxWidth, Math.max(minWidth, width));
}

export function readStoredSidebarCollapsed(storage: Storage | undefined): boolean {
  return storage?.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

export function writeStoredSidebarWidth(storage: Storage | undefined, width: number): void {
  storage?.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
}

export function writeStoredSidebarCollapsed(
  storage: Storage | undefined,
  collapsed: boolean,
): void {
  storage?.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
}
