import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export class MetadataStore {
  constructor(userDataPath) {
    fs.mkdirSync(userDataPath, { recursive: true });
    this.db = new DatabaseSync(path.join(userDataPath, "slate.db"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_attachments (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        local_path TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        retries INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS keyboard_shortcuts (
        action TEXT PRIMARY KEY,
        shortcut TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        relative_path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        accepted_revision INTEGER NOT NULL DEFAULT 0,
        server_seq INTEGER NOT NULL DEFAULT 0,
        sync_state TEXT NOT NULL DEFAULT 'offline',
        dirty INTEGER NOT NULL DEFAULT 0,
        deleted INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);

    try { this.db.exec("ALTER TABLE notes ADD COLUMN crdt_state BLOB"); } catch {}
    try { this.db.exec("ALTER TABLE notes ADD COLUMN state_vector BLOB"); } catch {}
    try { this.db.exec("ALTER TABLE notes ADD COLUMN server_seq INTEGER NOT NULL DEFAULT 0"); } catch {}
    try { this.db.exec("ALTER TABLE notes ADD COLUMN disk_content_hash TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE notes ADD COLUMN disk_mtime_ms REAL"); } catch {}
    try { this.db.exec("ALTER TABLE notes ADD COLUMN disk_size INTEGER"); } catch {}
    try { this.db.exec("ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0"); } catch {}
  }

  getSetting(key, fallbackValue = null) {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? JSON.parse(row.value) : fallbackValue;
  }

  setSetting(key, value) {
    this.db
      .prepare(`
        INSERT INTO settings(key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(key, JSON.stringify(value));
  }

  deleteSetting(key) {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  upsertNote(note) {
    const serverSeq = note.serverSeq ?? note.acceptedRevision ?? 0;
    this.db
      .prepare(`
        INSERT INTO notes(id, relative_path, title, accepted_revision, server_seq, sync_state, dirty, deleted, updated_at, disk_content_hash, disk_mtime_ms, disk_size, pinned)
        VALUES (@id, @relativePath, @title, @acceptedRevision, @serverSeq, @syncState, @dirty, @deleted, @updatedAt, @diskContentHash, @diskMtimeMs, @diskSize, @pinned)
        ON CONFLICT(id) DO UPDATE SET
          relative_path = excluded.relative_path,
          title = excluded.title,
          accepted_revision = excluded.accepted_revision,
          server_seq = excluded.server_seq,
          sync_state = excluded.sync_state,
          dirty = excluded.dirty,
          deleted = excluded.deleted,
          updated_at = excluded.updated_at,
          disk_content_hash = excluded.disk_content_hash,
          disk_mtime_ms = excluded.disk_mtime_ms,
          disk_size = excluded.disk_size,
          pinned = excluded.pinned
      `)
      .run({
        ...note,
        acceptedRevision: note.acceptedRevision ?? serverSeq,
        serverSeq,
        diskContentHash: note.diskContentHash ?? null,
        diskMtimeMs: note.diskMtimeMs ?? null,
        diskSize: note.diskSize ?? null,
        pinned: note.pinned ?? 0,
      });
  }

  setPinned(noteId, pinned) {
    this.db.prepare("UPDATE notes SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, noteId);
  }

  updateNoteDiskSnapshot(noteId, { diskContentHash, diskMtimeMs, diskSize }) {
    this.db
      .prepare(
        "UPDATE notes SET disk_content_hash = ?, disk_mtime_ms = ?, disk_size = ? WHERE id = ?",
      )
      .run(diskContentHash, diskMtimeMs, diskSize, noteId);
  }

  getNoteById(id) {
    return this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
  }

  getNoteByPath(relativePath) {
    return this.db.prepare("SELECT * FROM notes WHERE relative_path = ?").get(relativePath);
  }

  listNotes() {
    return this.db.prepare("SELECT * FROM notes WHERE deleted = 0 ORDER BY updated_at DESC").all();
  }

  listDirtyNotes() {
    return this.db.prepare("SELECT * FROM notes WHERE dirty = 1 AND deleted = 0 ORDER BY updated_at DESC").all();
  }

  listNotesByPrefix(relativePathPrefix) {
    return this.db
      .prepare("SELECT * FROM notes WHERE deleted = 0 AND (relative_path = ? OR relative_path LIKE ?) ORDER BY relative_path ASC")
      .all(relativePathPrefix, `${relativePathPrefix}/%`);
  }

  listDeletedDirtyNotes() {
    return this.db.prepare("SELECT * FROM notes WHERE dirty = 1 AND deleted = 1 ORDER BY updated_at DESC").all();
  }

  purgeNote(noteId) {
    this.db.prepare("DELETE FROM notes WHERE id = ?").run(noteId);
  }

  markDeleted(relativePath) {
    this.db
      .prepare("UPDATE notes SET deleted = 1, dirty = 1, sync_state = 'pending', updated_at = ? WHERE relative_path = ?")
      .run(new Date().toISOString(), relativePath);
  }

  markDeletedByPrefix(relativePathPrefix) {
    this.db
      .prepare("UPDATE notes SET deleted = 1, dirty = 1, sync_state = 'pending', updated_at = ? WHERE relative_path = ? OR relative_path LIKE ?")
      .run(new Date().toISOString(), relativePathPrefix, `${relativePathPrefix}/%`);
  }

  getCrdtState(noteId) {
    return this.db.prepare("SELECT crdt_state FROM notes WHERE id = ?").get(noteId)?.crdt_state ?? null;
  }

  setCrdtState(noteId, buffer) {
    this.db.prepare("UPDATE notes SET crdt_state = ? WHERE id = ?").run(buffer, noteId);
  }

  getStateVector(noteId) {
    return this.db.prepare("SELECT state_vector FROM notes WHERE id = ?").get(noteId)?.state_vector ?? null;
  }

  setStateVector(noteId, buffer) {
    this.db.prepare("UPDATE notes SET state_vector = ? WHERE id = ?").run(buffer, noteId);
  }

  updateNoteRevision(noteId, revision) {
    this.db.prepare("UPDATE notes SET accepted_revision = ?, server_seq = ?, dirty = 0, sync_state = 'idle' WHERE id = ?").run(revision, revision, noteId);
  }

  updateNoteServerSeq(noteId, serverSeq) {
    this.db.prepare("UPDATE notes SET accepted_revision = ?, server_seq = ?, dirty = 0, sync_state = 'idle' WHERE id = ?").run(serverSeq, serverSeq, noteId);
  }

  markDirty(noteId) {
    this.db.prepare("UPDATE notes SET dirty = 1, sync_state = 'pending', updated_at = ? WHERE id = ?").run(new Date().toISOString(), noteId);
  }

  markNoteDirty(noteId) {
    return this.markDirty(noteId);
  }

  /** Mark every non-deleted note dirty so the next sync uploads local content (e.g. after sign-in). */
  markAllActiveNotesDirty() {
    this.db
      .prepare("UPDATE notes SET dirty = 1, sync_state = 'pending', updated_at = ? WHERE deleted = 0")
      .run(new Date().toISOString());
  }

  markClean(noteId) {
    this.db.prepare("UPDATE notes SET dirty = 0, sync_state = 'idle' WHERE id = ?").run(noteId);
  }

  clearNotes() {
    this.db.exec("DELETE FROM notes;");
  }

  insertPendingAttachment({ id, fileName, mimeType, localPath, userId, documentId }) {
    this.db
      .prepare(`
        INSERT INTO pending_attachments(id, file_name, mime_type, local_path, workspace_id, document_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(id, fileName, mimeType, localPath, userId, documentId);
  }

  listPendingAttachments() {
    return this.db.prepare("SELECT * FROM pending_attachments ORDER BY created_at ASC").all();
  }

  incrementPendingAttachmentRetries(id) {
    this.db.prepare("UPDATE pending_attachments SET retries = retries + 1 WHERE id = ?").run(id);
  }

  deletePendingAttachment(id) {
    this.db.prepare("DELETE FROM pending_attachments WHERE id = ?").run(id);
  }

  getShortcuts() {
    return this.db.prepare("SELECT action, shortcut FROM keyboard_shortcuts").all();
  }

  setShortcut(action, shortcut) {
    this.db
      .prepare(`
        INSERT INTO keyboard_shortcuts(action, shortcut)
        VALUES (?, ?)
        ON CONFLICT(action) DO UPDATE SET shortcut = excluded.shortcut
      `)
      .run(action, shortcut);
  }
}
