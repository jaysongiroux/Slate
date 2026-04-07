import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import fg from "fast-glob";
import { diskSnapshotForMarkdownFile, sha256Utf8 } from "./disk-content-hash.mjs";
import { reconcileWorkspaceDiskFromHashes } from "./workspace-disk-reconcile.mjs";
import { syncError, syncVerbose, syncWarn } from "./sync-logger.mjs";

function stripMarkdown(markdown) {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>#-]/g, " ")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromMarkdown(markdown, fallbackPath) {
  const heading = markdown.split("\n").find((line) => line.startsWith("# "));
  if (heading) {
    return heading.replace(/^#\s+/, "").trim();
  }

  if (typeof fallbackPath === "string" && fallbackPath.length > 0) {
    return path.basename(fallbackPath, ".md");
  }

  return "Untitled note";
}

function previewFromText(text) {
  return text.slice(0, 120) || "Empty note";
}

function slugifySegment(value, fallback = "untitled-note") {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

export class WorkspaceService {
  constructor({ metadataStore, defaultWorkspaceRoot, ydocManager }) {
    this.metadataStore = metadataStore;
    this.defaultWorkspaceRoot = defaultWorkspaceRoot;
    this.workspaceRoot = defaultWorkspaceRoot;
    this.suppressedPaths = new Set();
    /** Ignore watcher events for this absolute path until epoch ms (handles multi-fire chokidar). */
    this.selfWriteQuietUntil = new Map();
    this.watchDebounce = null;
    this.pendingDiskChangePaths = null;
    this.onDirtyChange = null;
    this.watcher = null;
    this.ydocManager = ydocManager || null;
    this.sendRemoteCrdtUpdate = null; // set externally by main.mjs
    this.sendCrdtStateReset = null; // set externally by main.mjs
    this.cancelMaterialize = null; // set externally by main.mjs
  }

  async initialize() {
    this.workspaceRoot = this.metadataStore.getSetting("workspaceRoot", this.defaultWorkspaceRoot);
    syncVerbose("workspace.initialize", { workspaceRoot: this.workspaceRoot });
    await fsPromises.mkdir(this.workspaceRoot, { recursive: true });
    this.metadataStore.setSetting("workspaceRoot", this.workspaceRoot);
    await this.indexWorkspace();
    this.startWatching();
  }

  onWorkspaceDirty(callback) {
    this.onDirtyChange = callback;
  }

  async reconcileDiskFromHashes() {
    return reconcileWorkspaceDiskFromHashes(this);
  }

  refreshNoteDiskSnapshot(noteId) {
    const row = this.metadataStore.getNoteById(noteId);
    if (!row || row.deleted) return;
    const relativePath = row.relative_path;
    try {
      const abs = path.join(this.workspaceRoot, relativePath);
      const markdown = fs.readFileSync(abs, "utf8");
      const snap = diskSnapshotForMarkdownFile(this.workspaceRoot, relativePath, markdown);
      this.metadataStore.updateNoteDiskSnapshot(noteId, snap);
    } catch (err) {
      console.error("refreshNoteDiskSnapshot failed:", err);
    }
  }

  /** Treat filesystem events for this absolute path as our own writes for a short window. */
  markSelfWrite(absolutePath, ttlMs = 2500) {
    this.selfWriteQuietUntil.set(path.normalize(absolutePath), Date.now() + ttlMs);
  }

  getSyncState() {
    return this.metadataStore.getSetting("backendReachable", false) &&
      this.metadataStore.getSetting("authStatus", "signed_out") === "authenticated"
      ? "pending"
      : "offline";
  }

  async setWorkspaceRoot(rootPath) {
    syncVerbose("workspace.setWorkspaceRoot", {
      previousWorkspaceRoot: this.workspaceRoot,
      nextWorkspaceRoot: rootPath,
    });
    this.workspaceRoot = rootPath;
    await fsPromises.mkdir(this.workspaceRoot, { recursive: true });
    this.metadataStore.setSetting("workspaceRoot", this.workspaceRoot);
    this.metadataStore.clearNotes();
    this.metadataStore.setSetting("lastServerSeq", 0);
    await this.indexWorkspace();
    this.startWatching();
    return this.getWorkspaceProfile();
  }

  getWorkspaceProfile() {
    const syncEnabled =
      this.metadataStore.getSetting("backendReachable", false) &&
      this.metadataStore.getSetting("authStatus", "signed_out") === "authenticated";
    return {
      id: "local-profile",
      name: this.metadataStore.getSetting("workspaceName", "Local Profile"),
      rootPath: this.workspaceRoot,
      linkedUserId: this.metadataStore.getSetting("authenticatedUserId", undefined),
      backendEndpoint: this.metadataStore.getSetting("backendEndpoint", "localhost:50051"),
      connected: syncEnabled,
    };
  }

  async listFolders() {
    const dirs = await fg("**/", {
      cwd: this.workspaceRoot,
      dot: false,
      onlyDirectories: true,
    });
    return dirs.map((d) => d.replace(/\/+$/, ""));
  }

  async listNotes() {
    await this.indexWorkspace();
    const rows = this.metadataStore.listNotes();
    return Promise.all(rows.map((row) => this.materializeRow(row)));
  }

  async loadNote(noteId) {
    const row = this.metadataStore.getNoteById(noteId);
    if (!row) {
      throw new Error(`Note ${noteId} not found`);
    }

    return this.materializeRow(row);
  }

  async createNote(parentPath = "") {
    const baseName = "untitled-note";
    let counter = 0;
    let relativePath;
    const safeParentPath = parentPath.replace(/^\/+|\/+$/g, "");

    do {
      const suffix = counter === 0 ? "" : `-${counter}`;
      relativePath = safeParentPath
        ? path.join(safeParentPath, `${baseName}${suffix}.md`)
        : `${baseName}${suffix}.md`;
      counter += 1;
    } while (!this.metadataStore.isPathAvailable(relativePath));

    const markdown = "# Untitled note\n";
    const absolutePath = path.join(this.workspaceRoot, relativePath);
    await fsPromises.mkdir(path.dirname(absolutePath), { recursive: true });
    const normalizedNew = path.normalize(absolutePath);
    this.suppressedPaths.add(normalizedNew);
    this.markSelfWrite(normalizedNew);
    await fsPromises.writeFile(absolutePath, markdown, "utf8");

    const note = this.createOrUpdateRow({
      relativePath,
      markdown,
      dirty: 1,
      syncState: this.getSyncState(),
      serverSeq: 0,
    });

    if (this.ydocManager) {
      await this.ydocManager.bootstrapFromMarkdown(note.id, markdown);
    }

    return this.materializeRow(note);
  }

  async createDailyNote() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const relativePath = `${dateStr}.md`;

    const existing = this.metadataStore.getNoteByPath(relativePath);
    if (existing) {
      return this.materializeRow(existing);
    }

    const markdown = `# ${dateStr}\n`;
    const absolutePath = path.join(this.workspaceRoot, relativePath);
    const normalizedDaily = path.normalize(absolutePath);
    this.suppressedPaths.add(normalizedDaily);
    this.markSelfWrite(normalizedDaily);
    await fsPromises.writeFile(absolutePath, markdown, "utf8");

    const note = this.createOrUpdateRow({
      relativePath,
      markdown,
      dirty: 1,
      syncState: this.getSyncState(),
      serverSeq: 0,
    });

    if (this.ydocManager) {
      await this.ydocManager.bootstrapFromMarkdown(note.id, markdown);
    }

    return this.materializeRow(note);
  }

  async createFolder(parentPath = "") {
    const baseName = "untitled-folder";
    const safeParentPath = parentPath.replace(/^\/+|\/+$/g, "");
    let counter = 0;
    let relativePath;

    do {
      const suffix = counter === 0 ? "" : `-${counter}`;
      relativePath = safeParentPath
        ? path.join(safeParentPath, `${baseName}${suffix}`)
        : `${baseName}${suffix}`;
      counter += 1;
    } while (
      await fsPromises.stat(path.join(this.workspaceRoot, relativePath)).then(
        () => true,
        () => false,
      )
    );

    await fsPromises.mkdir(path.join(this.workspaceRoot, relativePath), { recursive: true });
    return relativePath;
  }

  resolveUniqueNotePath(parentPath, title, excludeId) {
    const safeParentPath = parentPath.replace(/^\/+|\/+$/g, "");
    const baseName = slugifySegment(title);
    let counter = 0;
    let relativePath;

    do {
      const suffix = counter === 0 ? "" : `-${counter}`;
      relativePath = safeParentPath
        ? path.join(safeParentPath, `${baseName}${suffix}.md`)
        : `${baseName}${suffix}.md`;
      counter += 1;
    } while (
      !this.metadataStore.isPathAvailable(relativePath) &&
      this.metadataStore.getNoteByPath(relativePath)?.id !== excludeId
    );

    return relativePath;
  }

  /**
   * Picks a non-colliding .md path under `safeParentPath` (empty string = workspace root),
   * keeping `preferredFileName` when free. `excludeId` is the note being moved.
   */
  resolveUniqueNoteFileInFolder(safeParentPath, preferredFileName, excludeId) {
    const stem = path.basename(preferredFileName, ".md");
    let counter = 0;
    let relativePath;

    do {
      const suffix = counter === 0 ? "" : `-${counter}`;
      const fileName = `${stem}${suffix}.md`;
      relativePath = safeParentPath ? path.join(safeParentPath, fileName) : fileName;
      counter += 1;
    } while (
      !this.metadataStore.isPathAvailable(relativePath) &&
      this.metadataStore.getNoteByPath(relativePath)?.id !== excludeId
    );

    return relativePath;
  }

  async moveNote(noteId, targetFolderPath = "") {
    const row = this.metadataStore.getNoteById(noteId);
    if (!row || row.deleted) {
      throw new Error(`Note ${noteId} not found`);
    }

    const safeTarget =
      typeof targetFolderPath === "string" ? targetFolderPath.replace(/^\/+|\/+$/g, "") : "";

    if (safeTarget.includes("..") || path.isAbsolute(safeTarget)) {
      throw new Error("Invalid folder path");
    }

    if (safeTarget) {
      const absFolder = path.join(this.workspaceRoot, safeTarget);
      let stat;
      try {
        stat = await fsPromises.stat(absFolder);
      } catch {
        throw new Error("Target folder does not exist");
      }
      if (!stat.isDirectory()) {
        throw new Error("Target is not a folder");
      }
    }

    const currentRelativePath = row.relative_path;
    const baseName = path.basename(currentRelativePath);
    const nextRelativePath = this.resolveUniqueNoteFileInFolder(safeTarget, baseName, row.id);

    if (nextRelativePath === currentRelativePath) {
      return this.materializeRow(row);
    }

    const currentAbsolutePath = path.join(this.workspaceRoot, currentRelativePath);
    const nextAbsolutePath = path.join(this.workspaceRoot, nextRelativePath);

    const markdown = await fsPromises.readFile(currentAbsolutePath, "utf8");

    await fsPromises.mkdir(path.dirname(nextAbsolutePath), { recursive: true });
    const normCurrent = path.normalize(currentAbsolutePath);
    const normNext = path.normalize(nextAbsolutePath);
    this.suppressedPaths.add(normCurrent);
    this.suppressedPaths.add(normNext);
    this.markSelfWrite(normCurrent);
    this.markSelfWrite(normNext);

    await fsPromises.rename(currentAbsolutePath, nextAbsolutePath);

    const note = this.createOrUpdateRow({
      id: row.id,
      relativePath: nextRelativePath,
      markdown,
      title: row.title,
      dirty: 1,
      syncState: this.getSyncState(),
      serverSeq: row.server_seq ?? row.accepted_revision,
    });

    this.scheduleDirtyCallback({ diskRelPath: nextRelativePath });
    return this.materializeRow(note);
  }

  /**
   * Move a folder (and subtree on disk) under `targetParentPath` (empty string = workspace root).
   */
  async moveFolder(folderPath, targetParentPath = "") {
    const normalizedFolderPath = folderPath.replace(/^\/+|\/+$/g, "");
    const safeTarget =
      typeof targetParentPath === "string" ? targetParentPath.replace(/^\/+|\/+$/g, "") : "";

    if (
      !normalizedFolderPath ||
      normalizedFolderPath.includes("..") ||
      path.isAbsolute(normalizedFolderPath)
    ) {
      throw new Error("Invalid folder path");
    }
    if (safeTarget.includes("..") || path.isAbsolute(safeTarget)) {
      throw new Error("Invalid target folder path");
    }

    if (safeTarget === normalizedFolderPath || safeTarget.startsWith(`${normalizedFolderPath}/`)) {
      throw new Error("Cannot move a folder into itself or its subfolder");
    }

    const baseName = path.basename(normalizedFolderPath);
    const nextFolderPath = safeTarget ? `${safeTarget}/${baseName}` : baseName;

    if (nextFolderPath === normalizedFolderPath) {
      return;
    }

    if (safeTarget) {
      const absParent = path.join(this.workspaceRoot, safeTarget);
      let pstat;
      try {
        pstat = await fsPromises.stat(absParent);
      } catch {
        throw new Error("Target folder does not exist");
      }
      if (!pstat.isDirectory()) {
        throw new Error("Target is not a folder");
      }
    }

    const currentAbsolutePath = path.join(this.workspaceRoot, normalizedFolderPath);
    const nextAbsolutePath = path.join(this.workspaceRoot, nextFolderPath);

    let stat;
    try {
      stat = await fsPromises.stat(currentAbsolutePath);
    } catch {
      throw new Error("Folder does not exist");
    }
    if (!stat.isDirectory()) {
      throw new Error("Path is not a folder");
    }

    const destExists = await fsPromises.stat(nextAbsolutePath).then(
      () => true,
      () => false,
    );
    if (destExists) {
      throw new Error(`A folder named "${baseName}" already exists in the destination`);
    }

    await fsPromises.mkdir(path.dirname(nextAbsolutePath), { recursive: true });
    const normCurrent = path.normalize(currentAbsolutePath);
    const normNext = path.normalize(nextAbsolutePath);
    this.suppressedPaths.add(normCurrent);
    this.suppressedPaths.add(normNext);
    this.markSelfWrite(normCurrent);
    this.markSelfWrite(normNext);

    await fsPromises.rename(currentAbsolutePath, nextAbsolutePath);

    const rows = this.metadataStore.listNotesByPrefix(normalizedFolderPath);
    for (const row of rows) {
      const suffix = row.relative_path.slice(normalizedFolderPath.length);
      const nextRelativePath = `${nextFolderPath}${suffix}`;
      const markdown = await fsPromises.readFile(
        path.join(this.workspaceRoot, nextRelativePath),
        "utf8",
      );
      this.createOrUpdateRow({
        id: row.id,
        relativePath: nextRelativePath,
        markdown,
        title: row.title,
        dirty: 1,
        syncState: this.getSyncState(),
        serverSeq: row.server_seq ?? row.accepted_revision,
      });
    }

    this.scheduleDirtyCallback();
  }

  async saveNote(payload) {
    const row = this.metadataStore.getNoteById(payload.id);
    if (!row) {
      throw new Error(`Note ${payload.id} not found`);
    }

    const currentRelativePath =
      typeof row.relative_path === "string" && row.relative_path.length > 0
        ? row.relative_path
        : path.join("notes", `${payload.id}.md`);

    const nextTitle =
      titleFromMarkdown(payload.markdown, currentRelativePath) ||
      payload.title?.trim() ||
      "Untitled note";
    const currentDirectory = path.dirname(currentRelativePath);
    const nextRelativePath = this.resolveUniqueNotePath(currentDirectory, nextTitle, row.id);
    const currentAbsolutePath = path.join(this.workspaceRoot, currentRelativePath);
    const nextAbsolutePath = path.join(this.workspaceRoot, nextRelativePath);

    if (nextRelativePath !== currentRelativePath) {
      await fsPromises.mkdir(path.dirname(nextAbsolutePath), { recursive: true });
      const normCurrent = path.normalize(currentAbsolutePath);
      const normNext = path.normalize(nextAbsolutePath);
      this.suppressedPaths.add(normCurrent);
      this.suppressedPaths.add(normNext);
      this.markSelfWrite(normCurrent);
      this.markSelfWrite(normNext);
      await fsPromises.rename(currentAbsolutePath, nextAbsolutePath);
    } else {
      const normNext = path.normalize(nextAbsolutePath);
      this.suppressedPaths.add(normNext);
      this.markSelfWrite(normNext);
    }

    await fsPromises.writeFile(nextAbsolutePath, payload.markdown, "utf8");

    const note = this.createOrUpdateRow({
      id: row.id,
      relativePath: nextRelativePath,
      markdown: payload.markdown,
      title: nextTitle,
      dirty: 1,
      syncState: this.getSyncState(),
      serverSeq: row.server_seq ?? row.accepted_revision,
    });

    return this.materializeRow(note);
  }

  async deleteNote(noteId) {
    const row = this.metadataStore.getNoteById(noteId);
    if (!row) {
      throw new Error(`Note ${noteId} not found`);
    }

    const absolutePath = path.join(this.workspaceRoot, row.relative_path);
    const normDel = path.normalize(absolutePath);
    this.suppressedPaths.add(normDel);
    this.markSelfWrite(normDel);

    try {
      await fsPromises.unlink(absolutePath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    this.metadataStore.markDeleted(row.relative_path);
    this.scheduleDirtyCallback();
  }

  async renameFolder(folderPath, nextName) {
    const normalizedFolderPath = folderPath.replace(/^\/+|\/+$/g, "");
    const sanitizedName = slugifySegment(nextName, "folder");
    const parentPath = path.dirname(normalizedFolderPath);
    const nextFolderPath =
      parentPath === "." ? sanitizedName : path.join(parentPath, sanitizedName);

    if (nextFolderPath === normalizedFolderPath) {
      return;
    }

    const currentAbsolutePath = path.join(this.workspaceRoot, normalizedFolderPath);
    const nextAbsolutePath = path.join(this.workspaceRoot, nextFolderPath);

    const destExists = await fsPromises.stat(nextAbsolutePath).then(
      () => true,
      () => false,
    );
    if (destExists) {
      throw new Error(`A folder named "${sanitizedName}" already exists in this location`);
    }

    await fsPromises.mkdir(path.dirname(nextAbsolutePath), { recursive: true });
    await fsPromises.rename(currentAbsolutePath, nextAbsolutePath);

    const rows = this.metadataStore.listNotesByPrefix(normalizedFolderPath);
    for (const row of rows) {
      const suffix = row.relative_path.slice(normalizedFolderPath.length);
      const nextRelativePath = `${nextFolderPath}${suffix}`;
      const markdown = await fsPromises.readFile(
        path.join(this.workspaceRoot, nextRelativePath),
        "utf8",
      );
      this.createOrUpdateRow({
        id: row.id,
        relativePath: nextRelativePath,
        markdown,
        title: row.title,
        dirty: row.dirty,
        syncState: row.sync_state,
        serverSeq: row.server_seq ?? row.accepted_revision,
      });
    }
  }

  async deleteFolder(folderPath) {
    const normalizedFolderPath = folderPath.replace(/^\/+|\/+$/g, "");
    const absolutePath = path.join(this.workspaceRoot, normalizedFolderPath);
    await fsPromises.rm(absolutePath, { recursive: true, force: true });
    this.metadataStore.markDeletedByPrefix(normalizedFolderPath);
    this.scheduleDirtyCallback();
  }

  async searchNotes(query) {
    const notes = await this.listNotes();
    const lowerQuery = query.toLowerCase();
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(lowerQuery) ||
        note.plainText.toLowerCase().includes(lowerQuery),
    );
  }

  async replaceInNote(noteId, searchString, replacement) {
    const row = this.metadataStore.getNoteById(noteId);
    if (!row) return;

    const absolutePath = path.join(this.workspaceRoot, row.relative_path);
    let markdown;
    try {
      markdown = await fsPromises.readFile(absolutePath, "utf8");
    } catch {
      return;
    }

    if (!markdown.includes(searchString)) return;

    const updated = markdown.replaceAll(searchString, replacement);
    const normRep = path.normalize(absolutePath);
    this.suppressedPaths.add(normRep);
    this.markSelfWrite(normRep);
    await fsPromises.writeFile(absolutePath, updated, "utf8");

    this.createOrUpdateRow({
      id: row.id,
      relativePath: row.relative_path,
      markdown: updated,
      title: row.title,
      dirty: 1,
      syncState: this.getSyncState(),
      serverSeq: row.server_seq ?? row.accepted_revision,
    });
  }

  async writeRemoteNote(note) {
    const relativePath = note.path;
    const existing = this.metadataStore.getNoteById(note.id);
    if (existing?.relative_path && existing.relative_path !== relativePath) {
      const previousAbsolutePath = path.join(this.workspaceRoot, existing.relative_path);
      const normPrev = path.normalize(previousAbsolutePath);
      this.suppressedPaths.add(normPrev);
      this.markSelfWrite(normPrev);
      try {
        await fsPromises.unlink(previousAbsolutePath);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }

    const absolutePath = path.join(this.workspaceRoot, relativePath);
    await fsPromises.mkdir(path.dirname(absolutePath), { recursive: true });
    const normRemote = path.normalize(absolutePath);
    this.suppressedPaths.add(normRemote);
    this.markSelfWrite(normRemote);
    await fsPromises.writeFile(absolutePath, note.markdown, "utf8");

    this.createOrUpdateRow({
      id: note.id,
      relativePath,
      markdown: note.markdown,
      title: note.title,
      dirty: 0,
      syncState: "idle",
      serverSeq: note.serverSeq ?? note.acceptedRevision,
      pinned: note.pinned ?? 0,
    });

    this.scheduleDirtyCallback({ diskRelPath: relativePath });
    if (existing?.relative_path && existing.relative_path !== relativePath) {
      this.scheduleDirtyCallback({ diskRelPath: existing.relative_path });
    }
  }

  startWatching() {
    if (this.watcher) {
      syncVerbose("workspace.startWatching: closing previous watcher", {
        workspaceRoot: this.workspaceRoot,
      });
      void this.watcher.close();
    }

    const watchTarget = this.workspaceRoot;
    syncVerbose("workspace.startWatching: starting watcher", {
      workspaceRoot: this.workspaceRoot,
      watchTarget,
    });
    this.watcher = chokidar.watch(watchTarget, {
      ignored: (watchedPath, stats) =>
        Boolean(stats?.isFile()) && path.extname(watchedPath).toLowerCase() !== ".md",
      ignoreInitial: true,
      usePolling: true,
      interval: 250,
      atomic: 200,
      awaitWriteFinish: {
        stabilityThreshold: 250,
        pollInterval: 100,
      },
    });

    this.watcher.on("add", (absolutePath) => {
      syncVerbose("workspace.watcher:add", {
        absolutePath,
        relativePath: path.relative(this.workspaceRoot, absolutePath),
      });
      void this.ingestExternalChange(absolutePath);
    });
    this.watcher.on("change", (absolutePath) => {
      syncVerbose("workspace.watcher:change", {
        absolutePath,
        relativePath: path.relative(this.workspaceRoot, absolutePath),
      });
      void this.ingestExternalChange(absolutePath);
    });
    this.watcher.on("unlink", (absolutePath) => {
      const normalizedPath = path.normalize(absolutePath);
      const quietUntil = this.selfWriteQuietUntil.get(normalizedPath);
      if (quietUntil != null) {
        if (Date.now() < quietUntil) {
          syncVerbose("workspace.watcher:unlink suppressed by selfWriteQuietUntil", {
            absolutePath,
            quietUntil,
          });
          return;
        }
        this.selfWriteQuietUntil.delete(normalizedPath);
      }
      if (this.suppressedPaths.delete(normalizedPath)) {
        syncVerbose("workspace.watcher:unlink suppressed by suppressedPaths", {
          absolutePath,
        });
        return;
      }
      const relativePath = path.relative(this.workspaceRoot, absolutePath);
      syncWarn("workspace.watcher:unlink external delete detected", {
        absolutePath,
        relativePath,
      });
      this.metadataStore.markDeleted(relativePath);
      this.scheduleDirtyCallback({ diskRelPath: relativePath });
    });
    this.watcher.on("error", (error) => {
      syncError("workspace.watcher:error", error);
    });
  }

  scheduleDirtyCallback(options = {}) {
    const { diskRelPath } = options;
    if (diskRelPath != null) {
      if (!this.pendingDiskChangePaths) {
        this.pendingDiskChangePaths = new Set();
      }
      this.pendingDiskChangePaths.add(diskRelPath);
      syncVerbose("workspace.scheduleDirtyCallback: queued disk path", {
        diskRelPath,
        pendingCount: this.pendingDiskChangePaths.size,
      });
    }

    if (!this.onDirtyChange) {
      syncVerbose("workspace.scheduleDirtyCallback: skipped (no onDirtyChange handler)", {
        diskRelPath: diskRelPath ?? null,
      });
      return;
    }

    if (this.watchDebounce) {
      clearTimeout(this.watchDebounce);
    }

    this.watchDebounce = setTimeout(() => {
      const diskPaths = this.pendingDiskChangePaths ? Array.from(this.pendingDiskChangePaths) : [];
      this.pendingDiskChangePaths = null;
      syncVerbose("workspace.scheduleDirtyCallback: flushing", {
        diskPaths,
      });
      this.onDirtyChange(diskPaths);
    }, 1200);
  }

  async ingestExternalChange(absolutePath) {
    const normalizedPath = path.normalize(absolutePath);
    const quietUntil = this.selfWriteQuietUntil.get(normalizedPath);
    if (quietUntil != null) {
      if (Date.now() < quietUntil) {
        syncVerbose("workspace.ingestExternalChange: ignored self write window", {
          absolutePath,
          quietUntil,
        });
        return;
      }
      this.selfWriteQuietUntil.delete(normalizedPath);
    }
    if (this.suppressedPaths.delete(normalizedPath)) {
      syncVerbose("workspace.ingestExternalChange: ignored suppressed path", {
        absolutePath,
      });
      return;
    }

    const relativePath = path.relative(this.workspaceRoot, absolutePath);
    syncVerbose("workspace.ingestExternalChange: reading disk", {
      absolutePath,
      relativePath,
    });
    const markdown = await fsPromises.readFile(absolutePath, "utf8");
    const existing = this.metadataStore.getNoteByPath(relativePath);
    syncVerbose("workspace.ingestExternalChange: upserting note row", {
      relativePath,
      noteId: existing?.id ?? null,
      markdownLength: markdown.length,
      existed: Boolean(existing),
    });
    this.createOrUpdateRow({
      relativePath,
      markdown,
      dirty: 1,
      syncState: this.getSyncState(),
      serverSeq: existing?.server_seq ?? existing?.accepted_revision ?? 0,
    });

    // Propagate external file change to CRDT state
    await this.handleExternalFileChange(relativePath);

    this.scheduleDirtyCallback({ diskRelPath: relativePath });
  }

  async indexWorkspace() {
    const files = await fg("**/*.md", {
      cwd: this.workspaceRoot,
      dot: false,
      onlyFiles: true,
    });
    const diskPaths = new Set(files);
    let hasReconciledChanges = false;

    for (const relativePath of files) {
      const absolutePath = path.join(this.workspaceRoot, relativePath);
      const markdown = await fsPromises.readFile(absolutePath, "utf8");
      const existing = this.metadataStore.getNoteByPath(relativePath);
      const stat = await fsPromises.stat(absolutePath);
      const persistedUpdatedAt = existing?.updated_at ?? existing?.updatedAt;
      const persistedUpdatedAtMs = persistedUpdatedAt ? Date.parse(persistedUpdatedAt) : Number.NaN;
      // Do not use mtime vs updated_at alone: after sync we write the file (new mtime) but
      // updateNoteServerSeq does not bump updated_at, which would falsely re-mark notes dirty.
      const contentHash = sha256Utf8(markdown);
      const storedHash = existing?.disk_content_hash ?? null;
      const hashDiffers = Boolean(existing) && storedHash != null && contentHash !== storedHash;
      const mtimeFallback =
        Boolean(existing) &&
        storedHash == null &&
        Number.isFinite(persistedUpdatedAtMs) &&
        stat.mtimeMs > persistedUpdatedAtMs;
      const externallyModified = hashDiffers || mtimeFallback;
      // New notes (no existing row) must be marked dirty so they sync to the backend
      const isNew = !existing;
      const shouldMarkDirty = Boolean(existing?.dirty) || isNew || externallyModified;
      if (isNew || externallyModified) {
        syncVerbose("workspace.indexWorkspace: disk note requires ingestion", {
          relativePath,
          noteId: existing?.id ?? null,
          isNew,
          externallyModified,
          hashDiffers,
          mtimeFallback,
          shouldMarkDirty,
        });
      }
      const note = this.createOrUpdateRow({
        relativePath,
        markdown,
        dirty: shouldMarkDirty ? 1 : 0,
        syncState: shouldMarkDirty ? this.getSyncState() : (existing?.sync_state ?? "offline"),
        serverSeq: existing?.server_seq ?? existing?.accepted_revision ?? 0,
      });
      if (isNew && this.ydocManager) {
        await this.ydocManager.bootstrapFromMarkdown(note.id, markdown);
      } else if (externallyModified) {
        await this.handleExternalFileChange(relativePath);
      }
      if (isNew || externallyModified) {
        hasReconciledChanges = true;
      }
    }

    // Notes missing from disk were removed outside the app while not running.
    // Mark them deleted/dirty so they disappear locally and sync to backend.
    const trackedRows = this.metadataStore.listNotes();
    for (const row of trackedRows) {
      if (!diskPaths.has(row.relative_path)) {
        this.metadataStore.markDeleted(row.relative_path);
        this.ydocManager?.release?.(row.id);
        hasReconciledChanges = true;
      }
    }

    if (hasReconciledChanges) {
      this.scheduleDirtyCallback();
    }
  }

  createOrUpdateRow({ id, relativePath, markdown, title, dirty, syncState, serverSeq, pinned }) {
    const existing = this.metadataStore.getNoteByPath(relativePath);
    const plainText = stripMarkdown(markdown);
    const nextTitle = title?.trim() || titleFromMarkdown(markdown, relativePath);
    const nextServerSeq = serverSeq ?? existing?.server_seq ?? existing?.accepted_revision ?? 0;
    const snap = diskSnapshotForMarkdownFile(this.workspaceRoot, relativePath, markdown);
    const nextRow = {
      id: id ?? existing?.id ?? crypto.randomUUID(),
      relativePath,
      title: nextTitle,
      acceptedRevision: nextServerSeq,
      serverSeq: nextServerSeq,
      syncState,
      dirty,
      deleted: 0,
      updatedAt: new Date().toISOString(),
      diskContentHash: snap.diskContentHash,
      diskMtimeMs: snap.diskMtimeMs,
      diskSize: snap.diskSize,
      pinned: pinned ?? existing?.pinned ?? 0,
    };

    this.metadataStore.upsertNote(nextRow);

    return {
      ...nextRow,
      markdown,
      plainText,
      preview: previewFromText(plainText),
    };
  }

  async materializeRow(row) {
    const relativePath = row.relative_path ?? row.relativePath;
    if (typeof relativePath !== "string" || relativePath.length === 0) {
      throw new Error("Note is missing a relative path");
    }

    const absolutePath = path.join(this.workspaceRoot, relativePath);
    let markdown = "";
    try {
      markdown = await fsPromises.readFile(absolutePath, "utf8");
    } catch {
      markdown = "";
    }
    const plainText = stripMarkdown(markdown);
    return {
      id: row.id,
      title: row.title,
      path: relativePath,
      preview: previewFromText(plainText),
      markdown,
      plainText,
      updatedAt: row.updated_at ?? row.updatedAt,
      acceptedRevision: row.server_seq ?? row.accepted_revision ?? row.acceptedRevision,
      deleted: Boolean(row.deleted),
      syncState: row.sync_state ?? row.syncState,
      pinned: Boolean(row.pinned),
    };
  }

  async readNoteMarkdown(relativePath) {
    const absolutePath = path.join(this.workspaceRoot, relativePath);
    try {
      return await fsPromises.readFile(absolutePath, "utf8");
    } catch {
      return null;
    }
  }

  async listTemplates() {
    const templatesDir = path.join(this.workspaceRoot, "templates");
    try {
      await fsPromises.access(templatesDir);
    } catch {
      return [];
    }

    const results = [];

    async function walk(dir, relativeBase) {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(fullPath, relativePath);
        } else if (entry.name.endsWith(".md")) {
          const content = await fsPromises.readFile(fullPath, "utf8");
          const h1Match = content.match(/^#\s+(.+)$/m);
          const title = h1Match ? h1Match[1].trim() : entry.name.replace(/\.md$/, "");
          results.push({
            relativePath,
            title,
            fullPath,
          });
        }
      }
    }

    await walk(templatesDir, "");
    return results;
  }

  async createTemplate(parentPath = "") {
    const templatesDir = path.join(this.workspaceRoot, "templates");
    await fsPromises.mkdir(templatesDir, { recursive: true });

    const baseName = "untitled-template";
    let counter = 0;
    let relativePath;
    const safeParentPath = parentPath.replace(/^\/+|\/+$/g, "");
    const targetDir = safeParentPath ? path.join(templatesDir, safeParentPath) : templatesDir;
    await fsPromises.mkdir(targetDir, { recursive: true });

    do {
      const suffix = counter === 0 ? "" : `-${counter}`;
      const fileName = `${baseName}${suffix}.md`;
      relativePath = safeParentPath ? path.join(safeParentPath, fileName) : fileName;
      const absPath = path.join(templatesDir, relativePath);
      try {
        await fsPromises.access(absPath);
        counter += 1;
      } catch {
        break;
      }
    } while (true);

    const markdown = "# Untitled template\n";
    const absolutePath = path.join(templatesDir, relativePath);
    await fsPromises.writeFile(absolutePath, markdown, "utf8");

    const fullRelativePath = path.join("templates", relativePath);
    const note = this.createOrUpdateRow({
      relativePath: fullRelativePath,
      markdown,
      dirty: 1,
      syncState: this.getSyncState(),
      serverSeq: 0,
    });

    if (this.ydocManager) {
      await this.ydocManager.bootstrapFromMarkdown(note.id, markdown);
    }

    return this.materializeRow(note);
  }

  async readTemplateContent(relativePath) {
    const absolutePath = path.join(this.workspaceRoot, "templates", relativePath);
    try {
      const content = await fsPromises.readFile(absolutePath, "utf8");
      return content.replace(/^#\s+.+\n?/, "");
    } catch {
      return null;
    }
  }

  async writeMarkdownFile(relativePath, markdown) {
    const absolutePath = path.join(this.workspaceRoot, relativePath);
    await fsPromises.mkdir(path.dirname(absolutePath), { recursive: true });
    const normMd = path.normalize(absolutePath);
    this.suppressedPaths.add(normMd);
    this.markSelfWrite(normMd);
    await fsPromises.writeFile(absolutePath, markdown, "utf8");
  }

  async handleExternalFileChange(relativePath) {
    const row = this.metadataStore.getNoteByPath(relativePath);
    if (!row || !this.ydocManager) {
      syncWarn("workspace.handleExternalFileChange: skipped", {
        relativePath,
        hasRow: Boolean(row),
        hasYdocManager: Boolean(this.ydocManager),
      });
      return;
    }

    const newMarkdown = await this.readNoteMarkdown(row.relative_path);
    if (newMarkdown === null || newMarkdown === undefined) {
      syncWarn("workspace.handleExternalFileChange: markdown missing on disk", {
        relativePath,
        noteId: row.id,
      });
      return;
    }
    syncVerbose("workspace.handleExternalFileChange: replacing CRDT from markdown", {
      relativePath,
      noteId: row.id,
      markdownLength: newMarkdown.length,
    });

    // Cancel any pending materialize so stale editor content doesn't
    // overwrite the disk change we're about to ingest.
    this.cancelMaterialize?.(row.id);

    // Replace the existing Y.Doc's content rather than re-bootstrapping.
    // Re-bootstrap creates new client IDs that, when pushed to the server,
    // merge with the server's old client IDs and duplicate content.
    // replaceFromMarkdown deletes old content first (creating tombstones
    // that propagate correctly to the server) then inserts new content.
    try {
      await this.ydocManager.replaceFromMarkdown(row.id, newMarkdown);
      this.metadataStore.markDirty(row.id);
      this.sendCrdtStateReset?.(row.id);
      syncVerbose("workspace.handleExternalFileChange: CRDT updated and note marked dirty", {
        relativePath,
        noteId: row.id,
        resetSent: Boolean(this.sendCrdtStateReset),
      });
    } catch (err) {
      syncError("workspace.handleExternalFileChange: failed to convert markdown to CRDT", {
        relativePath,
        noteId: row.id,
        error: err,
      });
    }
  }
}
