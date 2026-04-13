/**
 * Strip RxDB-internal fields (prefixed with "_") so they don't cause
 * false positives when comparing server docs against client state.
 * The client's pull handler adds `_deleted`, `_rev`, etc. which the
 * server's `toXDoc` helpers never include.
 */
function stripRxdbFields(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(doc)) {
    if (!key.startsWith("_")) {
      out[key] = doc[key];
    }
  }
  return out;
}

/**
 * Compare the client's assumed master state against the actual current master.
 * Returns null if no conflict, or the current master document if there is one.
 *
 * RxDB sends `assumedMasterState` with each push — the last version the client
 * saw from the server. If the server's current version differs, another device
 * has written in between, and we have a conflict.
 */
export function detectConflict<T>(currentMaster: T | null, assumedMasterState: T | null): T | null {
  if (currentMaster === null && assumedMasterState === null) {
    return null;
  }
  if (currentMaster === null || assumedMasterState === null) {
    return currentMaster;
  }

  const masterJson = JSON.stringify(stripRxdbFields(currentMaster as Record<string, unknown>));
  const assumedJson = JSON.stringify(stripRxdbFields(assumedMasterState as Record<string, unknown>));

  if (masterJson === assumedJson) {
    return null;
  }

  return currentMaster;
}
