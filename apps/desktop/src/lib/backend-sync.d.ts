export function resolveBackendBaseUrl(endpoint: string | null | undefined): string | null;
export function resolveCollaborationUrl(endpoint: string | null | undefined): string | null;
export function emitSyncStatus(target: EventTarget, status: "syncing" | "idle" | "error"): void;
export function listenForSyncStatus(
  target: EventTarget,
  callback: (status: "syncing" | "idle" | "error") => void,
): () => void;
