const SIDEBAR_WIDTH_STORAGE_KEY = "slate.desktop.sidebar-width";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "slate.desktop.sidebar-collapsed";

export function readStoredSidebarWidth(storage, defaultWidth, minWidth, maxWidth) {
  const stored = storage?.getItem?.(SIDEBAR_WIDTH_STORAGE_KEY);
  const width = stored ? Number(stored) : defaultWidth;
  if (!Number.isFinite(width)) return defaultWidth;
  return Math.min(maxWidth, Math.max(minWidth, width));
}

export function readStoredSidebarCollapsed(storage) {
  return storage?.getItem?.(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

export function writeStoredSidebarWidth(storage, width) {
  storage?.setItem?.(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
}

export function writeStoredSidebarCollapsed(storage, collapsed) {
  storage?.setItem?.(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
}

export { SIDEBAR_WIDTH_STORAGE_KEY, SIDEBAR_COLLAPSED_STORAGE_KEY };
