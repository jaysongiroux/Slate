import { inspect } from "node:util";

const PREFIX = "[SlateSync]";
const AUTH_PREFIX = "[SlateAuth]";

/**
 * Desktop sync tracing for the main process (terminal / Electron logs).
 * Set SLATE_SYNC_LOG=0 or false to disable verbose lines; warnings/errors still print.
 */
export function isSyncVerboseEnabled() {
  const v = process.env.SLATE_SYNC_LOG;
  if (v === "0" || v === "false") return false;
  return true;
}

function ts() {
  return new Date().toISOString();
}

function formatMeta(meta) {
  if (meta === undefined || meta === null) return "";
  if (meta instanceof Error) {
    return inspect(
      { name: meta.name, message: meta.message, code: meta.code, stack: meta.stack?.split("\n").slice(0, 4).join("\n") },
      { colors: false, depth: 3 },
    );
  }
  if (typeof meta === "object") {
    return inspect(meta, { colors: false, depth: 4, breakLength: 100, maxArrayLength: 20 });
  }
  return String(meta);
}

export function syncVerbose(message, meta) {
  if (!isSyncVerboseEnabled()) return;
  const line = `${PREFIX} ${ts()} ${message}`;
  if (meta !== undefined) {
    console.log(line, formatMeta(meta));
  } else {
    console.log(line);
  }
}

export function syncWarn(message, meta) {
  const line = `${PREFIX} ${ts()} WARN ${message}`;
  if (meta !== undefined) {
    console.warn(line, formatMeta(meta));
  } else {
    console.warn(line);
  }
}

export function syncError(message, meta) {
  const line = `${PREFIX} ${ts()} ERROR ${message}`;
  if (meta !== undefined) {
    console.error(line, formatMeta(meta));
  } else {
    console.error(line);
  }
}

/**
 * Always logged (not gated by SLATE_SYNC_LOG) when the app transitions to signed-out
 * or equivalent so you can trace why the session ended.
 */
export function logAuthSignedOut(reason, meta) {
  const line = `${AUTH_PREFIX} ${ts()} signed out — reason: ${reason}`;
  if (meta !== undefined && meta !== null && typeof meta === "object" && Object.keys(meta).length > 0) {
    console.warn(line, formatMeta(meta));
  } else {
    console.warn(line);
  }
}
