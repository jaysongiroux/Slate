import crypto from "node:crypto";

function slugify(str) {
  return (
    str
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "untitled"
  );
}

function buildSummary(row) {
  return {
    id: row.id,
    title: row.title,
    path: row.relative_path,
    pinned: row.pinned === 1,
    isTemplate: row.is_template === 1,
    deleted: row.deleted === 1,
    updatedAt: row.updated_at,
    createdAt: row.created_at ?? row.updated_at,
  };
}

export class NoteStore {
  constructor({ metadataStore }) {
    this._db = metadataStore;
  }

  /** Ensure a path is not already in use; appends -1, -2, etc. if needed. */
  _uniquePath(basePath, excludeId = null) {
    let candidate = basePath;
    let counter = 1;
    while (true) {
      const existing = this._db.getNoteByPath(candidate);
      if (!existing || existing.id === excludeId || existing.deleted === 1) return candidate;
      candidate = `${basePath}-${counter++}`;
    }
  }

  _normalizeName(name, fallbackTitle) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    return trimmed || fallbackTitle;
  }

  _uniqueFolderPath(basePath) {
    const folderPaths = new Set(this.listFolders());
    let candidate = basePath;
    let counter = 1;
    while (true) {
      const noteConflict = this._db.getNoteByPath(candidate);
      if (!folderPaths.has(candidate) && !noteConflict) {
        return candidate;
      }
      candidate = `${basePath}-${counter++}`;
    }
  }

  _replacePathPrefix(pathValue, prefix, replacement) {
    if (pathValue === prefix) {
      return replacement;
    }
    return `${replacement}${pathValue.slice(prefix.length)}`;
  }

  _renameExplicitFolders(folderPath, nextFolderPath) {
    const existingFolders = this._db.listFolderPathsByPrefix?.(folderPath) ?? [];
    if (existingFolders.length === 0) {
      return;
    }

    this._db.deleteFoldersByPrefix?.(folderPath);
    for (const existingFolder of existingFolders) {
      const nextPath = this._replacePathPrefix(existingFolder, folderPath, nextFolderPath);
      this._db.upsertFolder?.(nextPath);
    }
  }

  createNote({ parentPath = "", name } = {}) {
    const id = crypto.randomUUID();
    const title = this._normalizeName(name, "Untitled");
    const slug = slugify(title);
    const base = parentPath ? `${parentPath}/${slug}` : slug;
    const path = this._uniquePath(base);
    const now = new Date().toISOString();
    this._db.upsertNote({
      id,
      path,
      title,
      isTemplate: false,
      deleted: false,
      pinned: false,
      updatedAt: now,
      createdAt: now,
    });
    return buildSummary(this._db.getNoteById(id));
  }

  createDailyNote() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const title = `${yyyy}-${mm}-${dd}`;
    const base = `daily/${title}`;
    const existing = this._db.getNoteByPath(base);
    if (existing) return buildSummary(existing);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this._db.upsertNote({
      id,
      path: base,
      title,
      isTemplate: false,
      deleted: false,
      pinned: false,
      updatedAt: now,
      createdAt: now,
    });
    return buildSummary(this._db.getNoteById(id));
  }

  createTemplate({ parentPath = "", name } = {}) {
    const id = crypto.randomUUID();
    const title = this._normalizeName(name, "Untitled Template");
    const slug = slugify(title);
    const base = parentPath ? `${parentPath}/${slug}` : `templates/${slug}`;
    const path = this._uniquePath(base);
    const now = new Date().toISOString();
    this._db.upsertNote({
      id,
      path,
      title,
      isTemplate: true,
      deleted: false,
      pinned: false,
      updatedAt: now,
      createdAt: now,
    });
    return buildSummary(this._db.getNoteById(id));
  }

  createFolder(parentPath = "", name = "New Folder") {
    const folderName = this._normalizeName(name, "New Folder");
    const baseName = slugify(folderName);
    const basePath = parentPath ? `${parentPath}/${baseName}` : baseName;
    const folderPath = this._uniqueFolderPath(basePath);
    this._db.upsertFolder?.(folderPath);
    return folderPath;
  }

  getNoteById(id) {
    const row = this._db.getNoteById(id);
    if (!row) return null;
    return buildSummary(row);
  }

  listNotes() {
    return this._db.listNotes().map(buildSummary);
  }

  listTemplates() {
    return this._db.listTemplates().map(buildSummary);
  }

  listFolders() {
    const notes = this._db.listNotes();
    const folders = new Set(this._db.listFolderPaths?.() ?? []);
    for (const note of notes) {
      const parts = note.relative_path.split("/");
      for (let i = 1; i < parts.length; i++) {
        folders.add(parts.slice(0, i).join("/"));
      }
    }
    return [...folders].sort();
  }

  deleteNote(noteId) {
    const row = this._db.getNoteById(noteId);
    if (!row) return;
    this._db.markDeleted(row.relative_path);
  }

  togglePinNote(noteId, pinned) {
    this._db.setPinned(noteId, pinned);
  }

  moveNote(noteId, targetFolderPath) {
    const row = this._db.getNoteById(noteId);
    if (!row) throw new Error(`Note ${noteId} not found`);
    const slug = row.relative_path.split("/").pop() ?? slugify(row.title);
    const base = targetFolderPath ? `${targetFolderPath}/${slug}` : slug;
    const newPath = this._uniquePath(base, noteId);
    this._db.upsertNote({
      id: noteId,
      path: newPath,
      title: row.title,
      isTemplate: row.is_template === 1,
      deleted: false,
      pinned: row.pinned === 1,
      updatedAt: new Date().toISOString(),
      createdAt: row.created_at ?? row.updated_at,
    });
    return buildSummary(this._db.getNoteById(noteId));
  }

  renameNote(noteId, newTitle) {
    const row = this._db.getNoteById(noteId);
    if (!row) throw new Error(`Note ${noteId} not found`);
    const parts = row.relative_path.split("/");
    parts[parts.length - 1] = slugify(newTitle);
    const base = parts.join("/");
    const newPath = this._uniquePath(base, noteId);
    this._db.upsertNote({
      id: noteId,
      path: newPath,
      title: row.title,
      isTemplate: row.is_template === 1,
      deleted: false,
      pinned: row.pinned === 1,
      updatedAt: new Date().toISOString(),
      createdAt: row.created_at ?? row.updated_at,
    });
    return buildSummary(this._db.getNoteById(noteId));
  }

  updateTitleFromContent(noteId, nextTitle) {
    const row = this._db.getNoteById(noteId);
    if (!row) throw new Error(`Note ${noteId} not found`);
    this._db.upsertNote({
      id: noteId,
      path: row.relative_path,
      title: nextTitle,
      isTemplate: row.is_template === 1,
      deleted: row.deleted === 1,
      pinned: row.pinned === 1,
      updatedAt: new Date().toISOString(),
      createdAt: row.created_at ?? row.updated_at,
      plainText: row.plain_text ?? "",
    });
    return buildSummary(this._db.getNoteById(noteId));
  }

  renameFolder(folderPath, newName) {
    const notes = this._db.listNotesByPrefix(folderPath);
    const parentParts = folderPath.split("/");
    parentParts[parentParts.length - 1] = slugify(newName);
    const newFolderPath = this._uniqueFolderPath(parentParts.join("/"));
    for (const note of notes) {
      const newPath = this._replacePathPrefix(note.relative_path, folderPath, newFolderPath);
      const unique = this._uniquePath(newPath, note.id);
      this._db.upsertNote({
        id: note.id,
        path: unique,
        title: note.title,
        isTemplate: note.is_template === 1,
        deleted: false,
        pinned: note.pinned === 1,
        updatedAt: new Date().toISOString(),
        createdAt: note.created_at ?? note.updated_at,
      });
    }
    this._renameExplicitFolders(folderPath, newFolderPath);
  }

  moveFolder(folderPath, targetParentPath) {
    const notes = this._db.listNotesByPrefix(folderPath);
    const folderName = folderPath.split("/").pop();
    const nextBase = targetParentPath ? `${targetParentPath}/${folderName}` : folderName;
    const newFolderBase = this._uniqueFolderPath(nextBase);
    for (const note of notes) {
      const newPath = this._replacePathPrefix(note.relative_path, folderPath, newFolderBase);
      const unique = this._uniquePath(newPath, note.id);
      this._db.upsertNote({
        id: note.id,
        path: unique,
        title: note.title,
        isTemplate: note.is_template === 1,
        deleted: false,
        pinned: note.pinned === 1,
        updatedAt: new Date().toISOString(),
        createdAt: note.created_at ?? note.updated_at,
      });
    }
    this._renameExplicitFolders(folderPath, newFolderBase);
  }

  deleteFolder(folderPath) {
    const notes = this._db.listNotesByPrefix(folderPath);
    const deletedIds = notes.map((n) => n.id);
    for (const note of notes) {
      this._db.markDeleted(note.relative_path);
    }
    this._db.deleteFoldersByPrefix?.(folderPath);
    return deletedIds;
  }

  updatePlainText(noteId, plainText) {
    this._db.updatePlainText(noteId, plainText);
  }

  upsertFromImport({ id, path, title, isTemplate = false }) {
    const uniquePath = this._uniquePath(path);
    const now = new Date().toISOString();
    this._db.upsertNote({
      id,
      path: uniquePath,
      title,
      isTemplate,
      deleted: false,
      pinned: false,
      updatedAt: now,
      createdAt: now,
    });
    return buildSummary(this._db.getNoteById(id));
  }

  getSnapshot() {
    return {
      notes: this.listNotes(),
      folders: this.listFolders(),
    };
  }
}
