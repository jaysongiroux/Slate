import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import fg from "fast-glob";

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
  constructor({ metadataStore, defaultWorkspaceRoot }) {
    this.metadataStore = metadataStore;
    this.defaultWorkspaceRoot = defaultWorkspaceRoot;
    this.workspaceRoot = defaultWorkspaceRoot;
    this.suppressedPaths = new Set();
    this.watchDebounce = null;
    this.onDirtyChange = null;
    this.watcher = null;
  }

  async initialize() {
    this.workspaceRoot = this.metadataStore.getSetting("workspaceRoot", this.defaultWorkspaceRoot);
    await fs.mkdir(this.workspaceRoot, { recursive: true });
    this.metadataStore.setSetting("workspaceRoot", this.workspaceRoot);
    await this.indexWorkspace();
    this.startWatching();
  }

  onWorkspaceDirty(callback) {
    this.onDirtyChange = callback;
  }

  getSyncState() {
    return this.metadataStore.getSetting("backendReachable", false) &&
      this.metadataStore.getSetting("authStatus", "signed_out") === "authenticated"
      ? "pending"
      : "offline";
  }

  async setWorkspaceRoot(rootPath) {
    this.workspaceRoot = rootPath;
    await fs.mkdir(this.workspaceRoot, { recursive: true });
    this.metadataStore.setSetting("workspaceRoot", this.workspaceRoot);
    this.metadataStore.clearNotes();
    this.metadataStore.setSetting("lastSeenRevision", 0);
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
      linkedWorkspaceId: this.metadataStore.getSetting("authenticatedWorkspaceId", undefined),
      linkedUserId: this.metadataStore.getSetting("authenticatedUserId", undefined),
      backendEndpoint: this.metadataStore.getSetting("backendEndpoint", "localhost:50051"),
      connected: syncEnabled
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
    } while (this.metadataStore.getNoteByPath(relativePath));

    const markdown = "# Untitled note\n";
    const absolutePath = path.join(this.workspaceRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    this.suppressedPaths.add(path.normalize(absolutePath));
    await fs.writeFile(absolutePath, markdown, "utf8");

    const note = this.createOrUpdateRow({
      relativePath,
      markdown,
      dirty: 1,
      syncState: this.getSyncState(),
      acceptedRevision: 0
    });

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
      await fs.stat(path.join(this.workspaceRoot, relativePath)).then(() => true, () => false)
    );

    await fs.mkdir(path.join(this.workspaceRoot, relativePath), { recursive: true });
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
    } while (this.metadataStore.getNoteByPath(relativePath)?.id !== excludeId && this.metadataStore.getNoteByPath(relativePath));

    return relativePath;
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

    const nextTitle = titleFromMarkdown(payload.markdown, currentRelativePath) || payload.title?.trim() || "Untitled note";
    const currentDirectory = path.dirname(currentRelativePath);
    const nextRelativePath = this.resolveUniqueNotePath(currentDirectory, nextTitle, row.id);
    const currentAbsolutePath = path.join(this.workspaceRoot, currentRelativePath);
    const nextAbsolutePath = path.join(this.workspaceRoot, nextRelativePath);

    if (nextRelativePath !== currentRelativePath) {
      await fs.mkdir(path.dirname(nextAbsolutePath), { recursive: true });
      this.suppressedPaths.add(path.normalize(currentAbsolutePath));
      this.suppressedPaths.add(path.normalize(nextAbsolutePath));
      await fs.rename(currentAbsolutePath, nextAbsolutePath);
    } else {
      this.suppressedPaths.add(path.normalize(nextAbsolutePath));
    }

    await fs.writeFile(nextAbsolutePath, payload.markdown, "utf8");

    const note = this.createOrUpdateRow({
      id: row.id,
      relativePath: nextRelativePath,
      markdown: payload.markdown,
      title: nextTitle,
      dirty: 1,
      syncState: this.getSyncState(),
      acceptedRevision: row.accepted_revision
    });

    return this.materializeRow(note);
  }

  async deleteNote(noteId) {
    const row = this.metadataStore.getNoteById(noteId);
    if (!row) {
      throw new Error(`Note ${noteId} not found`);
    }

    const absolutePath = path.join(this.workspaceRoot, row.relative_path);
    this.suppressedPaths.add(path.normalize(absolutePath));

    try {
      await fs.unlink(absolutePath);
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
    const nextFolderPath = parentPath === "." ? sanitizedName : path.join(parentPath, sanitizedName);

    if (nextFolderPath === normalizedFolderPath) {
      return;
    }

    const currentAbsolutePath = path.join(this.workspaceRoot, normalizedFolderPath);
    const nextAbsolutePath = path.join(this.workspaceRoot, nextFolderPath);
    await fs.mkdir(path.dirname(nextAbsolutePath), { recursive: true });
    await fs.rename(currentAbsolutePath, nextAbsolutePath);

    const rows = this.metadataStore.listNotesByPrefix(normalizedFolderPath);
    for (const row of rows) {
      const suffix = row.relative_path.slice(normalizedFolderPath.length);
      const nextRelativePath = `${nextFolderPath}${suffix}`;
      const markdown = await fs.readFile(path.join(this.workspaceRoot, nextRelativePath), "utf8");
      this.createOrUpdateRow({
        id: row.id,
        relativePath: nextRelativePath,
        markdown,
        title: row.title,
        dirty: row.dirty,
        syncState: row.sync_state,
        acceptedRevision: row.accepted_revision,
      });
    }
  }

  async deleteFolder(folderPath) {
    const normalizedFolderPath = folderPath.replace(/^\/+|\/+$/g, "");
    const absolutePath = path.join(this.workspaceRoot, normalizedFolderPath);
    await fs.rm(absolutePath, { recursive: true, force: true });
    this.metadataStore.markDeletedByPrefix(normalizedFolderPath);
    this.scheduleDirtyCallback();
  }

  async searchNotes(query) {
    const notes = await this.listNotes();
    const lowerQuery = query.toLowerCase();
    return notes.filter((note) =>
      note.title.toLowerCase().includes(lowerQuery) ||
      note.plainText.toLowerCase().includes(lowerQuery)
    );
  }

  async replaceInNote(noteId, searchString, replacement) {
    const row = this.metadataStore.getNoteById(noteId);
    if (!row) return;

    const absolutePath = path.join(this.workspaceRoot, row.relative_path);
    let markdown;
    try {
      markdown = await fs.readFile(absolutePath, "utf8");
    } catch {
      return;
    }

    if (!markdown.includes(searchString)) return;

    const updated = markdown.replaceAll(searchString, replacement);
    this.suppressedPaths.add(path.normalize(absolutePath));
    await fs.writeFile(absolutePath, updated, "utf8");

    this.createOrUpdateRow({
      id: row.id,
      relativePath: row.relative_path,
      markdown: updated,
      title: row.title,
      dirty: 1,
      syncState: this.getSyncState(),
      acceptedRevision: row.accepted_revision,
    });
  }

  async writeRemoteNote(note) {
    const relativePath = note.path;
    const absolutePath = path.join(this.workspaceRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    this.suppressedPaths.add(path.normalize(absolutePath));
    await fs.writeFile(absolutePath, note.markdown, "utf8");

    this.createOrUpdateRow({
      id: note.id,
      relativePath,
      markdown: note.markdown,
      title: note.title,
      dirty: 0,
      syncState: "idle",
      acceptedRevision: note.acceptedRevision
    });
  }

  startWatching() {
    if (this.watcher) {
      void this.watcher.close();
    }

    this.watcher = chokidar.watch(path.join(this.workspaceRoot, "**/*.md"), {
      ignoreInitial: true
    });

    this.watcher.on("add", (absolutePath) => void this.ingestExternalChange(absolutePath));
    this.watcher.on("change", (absolutePath) => void this.ingestExternalChange(absolutePath));
    this.watcher.on("unlink", (absolutePath) => {
      const normalizedPath = path.normalize(absolutePath);
      if (this.suppressedPaths.delete(normalizedPath)) {
        return;
      }
      const relativePath = path.relative(this.workspaceRoot, absolutePath);
      this.metadataStore.markDeleted(relativePath);
      this.scheduleDirtyCallback();
    });
  }

  scheduleDirtyCallback() {
    if (!this.onDirtyChange) {
      return;
    }

    if (this.watchDebounce) {
      clearTimeout(this.watchDebounce);
    }

    this.watchDebounce = setTimeout(() => {
      this.onDirtyChange();
    }, 1200);
  }

  async ingestExternalChange(absolutePath) {
    const normalizedPath = path.normalize(absolutePath);
    if (this.suppressedPaths.delete(normalizedPath)) {
      return;
    }

    const relativePath = path.relative(this.workspaceRoot, absolutePath);
    const markdown = await fs.readFile(absolutePath, "utf8");
    const existing = this.metadataStore.getNoteByPath(relativePath);
    this.createOrUpdateRow({
      relativePath,
      markdown,
      dirty: 1,
      syncState: this.getSyncState(),
      acceptedRevision: existing?.accepted_revision ?? 0
    });
    this.scheduleDirtyCallback();
  }

  async indexWorkspace() {
    const files = await fg("**/*.md", {
      cwd: this.workspaceRoot,
      dot: false,
      onlyFiles: true
    });

    for (const relativePath of files) {
      const absolutePath = path.join(this.workspaceRoot, relativePath);
      const markdown = await fs.readFile(absolutePath, "utf8");
      const existing = this.metadataStore.getNoteByPath(relativePath);
      this.createOrUpdateRow({
        relativePath,
        markdown,
        dirty: existing?.dirty ?? 0,
        syncState: existing?.sync_state ?? "offline",
        acceptedRevision: existing?.accepted_revision ?? 0
      });
    }
  }

  createOrUpdateRow({ id, relativePath, markdown, title, dirty, syncState, acceptedRevision }) {
    const existing = this.metadataStore.getNoteByPath(relativePath);
    const plainText = stripMarkdown(markdown);
    const nextTitle = title?.trim() || titleFromMarkdown(markdown, relativePath);
    const nextRow = {
      id: id ?? existing?.id ?? crypto.randomUUID(),
      relativePath,
      title: nextTitle,
      acceptedRevision,
      syncState,
      dirty,
      deleted: 0,
      updatedAt: new Date().toISOString()
    };

    this.metadataStore.upsertNote(nextRow);

    return {
      ...nextRow,
      markdown,
      plainText,
      preview: previewFromText(plainText)
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
      markdown = await fs.readFile(absolutePath, "utf8");
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
      acceptedRevision: row.accepted_revision ?? row.acceptedRevision,
      deleted: Boolean(row.deleted),
      syncState: row.sync_state ?? row.syncState
    };
  }
}
