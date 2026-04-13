import fs from "node:fs";

/**
 * Structured desktop diagnostics: console + optional append-only log file under userData.
 * Log path is typically `…/userData/logs/slate-desktop.log`.
 */
export function createDesktopLogger({ logPath = null, alsoConsole = true } = {}) {
  function emit(level, scope, message, fields) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      scope,
      message,
      ...(fields && typeof fields === "object" ? fields : {}),
    };
    const line = `${JSON.stringify(entry)}\n`;
    if (alsoConsole) {
      const prefix = `[SlateDesktop][${scope}]`;
      if (level === "error") console.error(prefix, message, entry);
      else if (level === "warn") console.warn(prefix, message, entry);
      else console.info(prefix, message, entry);
    }
    if (logPath) {
      void fs.promises.appendFile(logPath, line, "utf8").catch(() => {});
    }
  }

  return {
    logPath,
    child(scope) {
      return {
        debug: (message, fields) => emit("debug", scope, message, fields),
        info: (message, fields) => emit("info", scope, message, fields),
        warn: (message, fields) => emit("warn", scope, message, fields),
        error: (message, fields) => emit("error", scope, message, fields),
      };
    },
    /** Renderer IPC: scope is included in message or fields.source */
    rawLine(jsonLine) {
      if (logPath) void fs.promises.appendFile(logPath, jsonLine, "utf8").catch(() => {});
    },
  };
}
