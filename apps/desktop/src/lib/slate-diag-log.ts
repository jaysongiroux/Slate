type DiagPayload = Record<string, unknown>;

function api() {
  return (window as Window & { slateDesktop?: { writeDiagLog?: (p: unknown) => Promise<void> } })
    .slateDesktop;
}

/** Batched renderer diagnostics → main process log file (`logs/slate-desktop.log`). */
export function slateDiagLog(scope: string, message: string, fields?: DiagPayload) {
  const payload = { scope, message, ...(fields ?? {}) };
  try {
    void api()?.writeDiagLog?.(payload);
  } catch {
    // ignore when not running in Electron
  }
}
