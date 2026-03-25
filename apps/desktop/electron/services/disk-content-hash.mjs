import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function sha256Utf8(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Snapshot of the on-disk .md file after a known markdown string was written or read.
 * Uses sync I/O; callers run from save paths where the file is expected to exist.
 */
export function diskSnapshotForMarkdownFile(workspaceRoot, relativePath, markdown) {
  try {
    const abs = path.join(workspaceRoot, relativePath);
    const st = fs.statSync(abs);
    return {
      diskContentHash: sha256Utf8(markdown),
      diskMtimeMs: st.mtimeMs,
      diskSize: st.size,
    };
  } catch {
    return { diskContentHash: null, diskMtimeMs: null, diskSize: null };
  }
}
