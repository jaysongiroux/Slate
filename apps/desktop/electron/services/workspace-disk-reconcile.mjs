import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { sha256Utf8 } from "./disk-content-hash.mjs";

/**
 * Walk workspace markdown files, compare stat + content hash to DB, and mark dirty / ingest
 * when something changed on disk without going through the watcher.
 * @returns {Promise<boolean>} true if anything was updated in a way that should trigger sync
 */
export async function reconcileWorkspaceDiskFromHashes(workspaceService) {
  const root = workspaceService.workspaceRoot;
  const metadataStore = workspaceService.metadataStore;

  const files = await fg("**/*.md", { cwd: root, dot: false, onlyFiles: true });
  const diskPaths = new Set(files);
  let changed = false;

  for (const relativePath of files) {
    const abs = path.join(root, relativePath);
    const st = await fs.stat(abs);
    const row = metadataStore.getNoteByPath(relativePath);

    if (!row) {
      const markdown = await fs.readFile(abs, "utf8");
      const note = workspaceService.createOrUpdateRow({
        relativePath,
        markdown,
        dirty: 1,
        syncState: workspaceService.getSyncState(),
        serverSeq: 0,
      });
      if (workspaceService.ydocManager) {
        await workspaceService.ydocManager.bootstrapFromMarkdown(note.id, markdown);
      }
      changed = true;
      continue;
    }

    const storedHash = row.disk_content_hash ?? null;
    const storedMtime = row.disk_mtime_ms != null ? Number(row.disk_mtime_ms) : null;
    const storedSize = row.disk_size != null ? Number(row.disk_size) : null;

    const mtimeOk =
      storedHash != null &&
      storedMtime != null &&
      storedSize != null &&
      Math.abs(st.mtimeMs - storedMtime) < 0.001 &&
      st.size === storedSize;

    if (mtimeOk) {
      continue;
    }

    const markdown = await fs.readFile(abs, "utf8");
    const hash = sha256Utf8(markdown);

    if (storedHash == null) {
      metadataStore.updateNoteDiskSnapshot(row.id, {
        diskContentHash: hash,
        diskMtimeMs: st.mtimeMs,
        diskSize: st.size,
      });
      continue;
    }

    if (hash === storedHash) {
      metadataStore.updateNoteDiskSnapshot(row.id, {
        diskContentHash: hash,
        diskMtimeMs: st.mtimeMs,
        diskSize: st.size,
      });
      continue;
    }

    workspaceService.createOrUpdateRow({
      id: row.id,
      relativePath,
      markdown,
      title: row.title,
      dirty: 1,
      syncState: workspaceService.getSyncState(),
      serverSeq: row.server_seq ?? row.accepted_revision ?? 0,
    });
    await workspaceService.handleExternalFileChange(relativePath);
    changed = true;
  }

  const tracked = metadataStore.listNotes();
  for (const row of tracked) {
    if (!diskPaths.has(row.relative_path)) {
      metadataStore.markDeleted(row.relative_path);
      workspaceService.ydocManager?.release?.(row.id);
      changed = true;
    }
  }

  if (changed) {
    workspaceService.scheduleDirtyCallback();
  }

  return changed;
}
