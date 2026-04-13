const SYNC_STATUS_EVENT = "slate:sync-status";

export function resolveBackendBaseUrl(endpoint) {
  if (typeof endpoint !== "string") return null;
  const trimmed = endpoint.trim();
  if (!trimmed) return null;

  const withScheme =
    trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `http://${trimmed}`;

  return withScheme.replace(/\/+$/, "");
}

export function resolveCollaborationUrl(endpoint) {
  const baseUrl = resolveBackendBaseUrl(endpoint);
  if (!baseUrl) return null;
  return baseUrl.replace(/^http/i, "ws") + "/collaboration";
}

export function emitSyncStatus(target, status) {
  target.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT, { detail: status }));
}

export function listenForSyncStatus(target, callback) {
  const handler = (event) => callback(event.detail);
  target.addEventListener(SYNC_STATUS_EVENT, handler);
  return () => target.removeEventListener(SYNC_STATUS_EVENT, handler);
}
