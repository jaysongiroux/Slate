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

      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        relative_path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        accepted_revision INTEGER NOT NULL DEFAULT 0,
        sync_state TEXT NOT NULL DEFAULT 'offline',
        dirty INTEGER NOT NULL DEFAULT 0,
        deleted INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);
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
    this.db
      .prepare(`
        INSERT INTO notes(id, relative_path, title, accepted_revision, sync_state, dirty, deleted, updated_at)
        VALUES (@id, @relativePath, @title, @acceptedRevision, @syncState, @dirty, @deleted, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET
          relative_path = excluded.relative_path,
          title = excluded.title,
          accepted_revision = excluded.accepted_revision,
          sync_state = excluded.sync_state,
          dirty = excluded.dirty,
          deleted = excluded.deleted,
          updated_at = excluded.updated_at
      `)
      .run(note);
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

  clearNotes() {
    this.db.exec("DELETE FROM notes;");
  }
}
