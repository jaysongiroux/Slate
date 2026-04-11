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

  const masterJson = JSON.stringify(currentMaster);
  const assumedJson = JSON.stringify(assumedMasterState);

  if (masterJson === assumedJson) {
    return null;
  }

  return currentMaster;
}
