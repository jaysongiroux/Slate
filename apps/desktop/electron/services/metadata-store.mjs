import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const CALENDAR_REMINDER_SETTINGS_KEY = "calendarReminderSettings";
const CALENDAR_REMINDER_FIRED_KEY = "calendarReminderFired";
const CALENDAR_REMINDER_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const DEFAULT_CALENDAR_REMINDER_SETTINGS = {
  enabled: false,
  minutesBeforeStart: 10,
  playSound: true,
  enabledCalendarIds: null,
};

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
        updated_at TEXT NOT NULL,
        created_at TEXT,
        crdt_state BLOB,
        state_vector BLOB,
        disk_content_hash TEXT,
        disk_mtime_ms REAL,
        disk_size INTEGER,
        pinned INTEGER NOT NULL DEFAULT 0,
        is_template INTEGER NOT NULL DEFAULT 0,
        plain_text TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS folders (
        path TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    this.ensureNoteColumn("crdt_state", "ALTER TABLE notes ADD COLUMN crdt_state BLOB");
    this.ensureNoteColumn("state_vector", "ALTER TABLE notes ADD COLUMN state_vector BLOB");
    this.ensureNoteColumn(
      "server_seq",
      "ALTER TABLE notes ADD COLUMN server_seq INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureNoteColumn(
      "disk_content_hash",
      "ALTER TABLE notes ADD COLUMN disk_content_hash TEXT",
    );
    this.ensureNoteColumn("disk_mtime_ms", "ALTER TABLE notes ADD COLUMN disk_mtime_ms REAL");
    this.ensureNoteColumn("disk_size", "ALTER TABLE notes ADD COLUMN disk_size INTEGER");
    this.ensureNoteColumn(
      "pinned",
      "ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureNoteColumn(
      "is_template",
      "ALTER TABLE notes ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureNoteColumn(
      "plain_text",
      "ALTER TABLE notes ADD COLUMN plain_text TEXT NOT NULL DEFAULT ''",
    );
    this.ensureNoteColumn("created_at", "ALTER TABLE notes ADD COLUMN created_at TEXT");
    this.db.exec(`
      UPDATE notes
      SET created_at = COALESCE(created_at, updated_at, datetime('now'))
      WHERE created_at IS NULL OR created_at = ''
    `);
  }

  getNoteColumnNames() {
    return new Set(
      this.db
        .prepare("PRAGMA table_info(notes)")
        .all()
        .map((column) => column.name),
    );
  }

  ensureNoteColumn(columnName, alterSql) {
    if (this.getNoteColumnNames().has(columnName)) return;
    this.db.exec(alterSql);
  }

  getSetting(key, fallbackValue = null) {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? JSON.parse(row.value) : fallbackValue;
  }

  setSetting(key, value) {
    this.db
      .prepare(
        `
        INSERT INTO settings(key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
      )
      .run(key, JSON.stringify(value));
  }

  deleteSetting(key) {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  getCalendarReminderSettings() {
    const value = this.getSetting(CALENDAR_REMINDER_SETTINGS_KEY, null);
    return {
      ...DEFAULT_CALENDAR_REMINDER_SETTINGS,
      ...(value && typeof value === "object" ? value : {}),
    };
  }

  setCalendarReminderSettings(value) {
    const next = {
      ...DEFAULT_CALENDAR_REMINDER_SETTINGS,
      ...(value && typeof value === "object" ? value : {}),
    };
    this.setSetting(CALENDAR_REMINDER_SETTINGS_KEY, next);
  }

  getCalendarReminderFired(now = Date.now()) {
    const value = this.getSetting(CALENDAR_REMINDER_FIRED_KEY, {});
    const pruned = this.pruneCalendarReminderFiredEntries(value, now);
    if (JSON.stringify(pruned) !== JSON.stringify(value ?? {})) {
      this.setSetting(CALENDAR_REMINDER_FIRED_KEY, pruned);
    }
    return pruned;
  }

  setCalendarReminderFired(value, now = Date.now()) {
    const pruned = this.pruneCalendarReminderFiredEntries(value, now);
    this.setSetting(CALENDAR_REMINDER_FIRED_KEY, pruned);
  }

  markCalendarReminderFired(key, firedAt = new Date().toISOString(), now = Date.now()) {
    const current = this.getCalendarReminderFired(now);
    current[key] = { firedAt };
    this.setCalendarReminderFired(current, now);
  }

  pruneCalendarReminderFiredEntries(value, now = Date.now()) {
    if (!value || typeof value !== "object") return {};
    const cutoff = now - CALENDAR_REMINDER_RETENTION_MS;
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => {
        if (!entry || typeof entry !== "object" || typeof entry.firedAt !== "string") return false;
        const firedAt = Date.parse(entry.firedAt);
        return Number.isFinite(firedAt) && firedAt >= cutoff;
      }),
    );
  }

  upsertNote(note) {
    const serverSeq = note.serverSeq ?? note.acceptedRevision ?? 0;
    this.db
      .prepare(
        `
        INSERT INTO notes(id, relative_path, title, accepted_revision, server_seq, sync_state, dirty, deleted, updated_at, created_at, disk_content_hash, disk_mtime_ms, disk_size, pinned, is_template, plain_text)
        VALUES (@id, @relativePath, @title, @acceptedRevision, @serverSeq, @syncState, @dirty, @deleted, @updatedAt, @createdAt, @diskContentHash, @diskMtimeMs, @diskSize, @pinned, @isTemplate, @plainText)
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
          pinned = excluded.pinned,
          is_template = excluded.is_template,
          plain_text = excluded.plain_text
      `,
      )
      .run({
        id: note.id,
        relativePath: note.relativePath ?? note.path,
        title: note.title,
        acceptedRevision: note.acceptedRevision ?? serverSeq,
        serverSeq,
        updatedAt: note.updatedAt ?? new Date().toISOString(),
        createdAt: note.createdAt ?? note.updatedAt ?? new Date().toISOString(),
        diskContentHash: note.diskContentHash ?? null,
        diskMtimeMs: note.diskMtimeMs ?? null,
        diskSize: note.diskSize ?? null,
        pinned: note.pinned ? 1 : 0,
        isTemplate: note.isTemplate ? 1 : 0,
        plainText: note.plainText ?? "",
        syncState: note.syncState ?? "offline",
        dirty: note.dirty ? 1 : 0,
        deleted: note.deleted ? 1 : 0,
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

  isPathAvailable(relativePath) {
    return !this.db
      .prepare("SELECT 1 FROM notes WHERE relative_path = ? AND deleted = 0")
      .get(relativePath);
  }

  listNotes() {
    return this.db.prepare("SELECT * FROM notes WHERE deleted = 0 ORDER BY updated_at DESC").all();
  }

  listDirtyNotes() {
    return this.db
      .prepare("SELECT * FROM notes WHERE dirty = 1 AND deleted = 0 ORDER BY updated_at DESC")
      .all();
  }

  listNotesByPrefix(relativePathPrefix) {
    return this.db
      .prepare(
        "SELECT * FROM notes WHERE deleted = 0 AND (relative_path = ? OR relative_path LIKE ?) ORDER BY relative_path ASC",
      )
      .all(relativePathPrefix, `${relativePathPrefix}/%`);
  }

  listDeletedDirtyNotes() {
    return this.db
      .prepare("SELECT * FROM notes WHERE dirty = 1 AND deleted = 1 ORDER BY updated_at DESC")
      .all();
  }

  purgeNote(noteId) {
    this.db.prepare("DELETE FROM notes WHERE id = ?").run(noteId);
  }

  markDeleted(relativePath) {
    this.db
      .prepare(
        "UPDATE notes SET deleted = 1, dirty = 1, sync_state = 'pending', updated_at = ? WHERE relative_path = ?",
      )
      .run(new Date().toISOString(), relativePath);
  }

  markDeletedByPrefix(relativePathPrefix) {
    this.db
      .prepare(
        "UPDATE notes SET deleted = 1, dirty = 1, sync_state = 'pending', updated_at = ? WHERE relative_path = ? OR relative_path LIKE ?",
      )
      .run(new Date().toISOString(), relativePathPrefix, `${relativePathPrefix}/%`);
  }

  getCrdtState(noteId) {
    return (
      this.db.prepare("SELECT crdt_state FROM notes WHERE id = ?").get(noteId)?.crdt_state ?? null
    );
  }

  setCrdtState(noteId, buffer) {
    this.db.prepare("UPDATE notes SET crdt_state = ? WHERE id = ?").run(buffer, noteId);
  }

  getStateVector(noteId) {
    return (
      this.db.prepare("SELECT state_vector FROM notes WHERE id = ?").get(noteId)?.state_vector ??
      null
    );
  }

  setStateVector(noteId, buffer) {
    this.db.prepare("UPDATE notes SET state_vector = ? WHERE id = ?").run(buffer, noteId);
  }

  updateNoteRevision(noteId, revision) {
    this.db
      .prepare(
        "UPDATE notes SET accepted_revision = ?, server_seq = ?, dirty = 0, sync_state = 'idle' WHERE id = ?",
      )
      .run(revision, revision, noteId);
  }

  updateNoteServerSeq(noteId, serverSeq) {
    this.db
      .prepare(
        "UPDATE notes SET accepted_revision = ?, server_seq = ?, dirty = 0, sync_state = 'idle' WHERE id = ?",
      )
      .run(serverSeq, serverSeq, noteId);
  }

  markDirty(noteId) {
    this.db
      .prepare("UPDATE notes SET dirty = 1, sync_state = 'pending', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), noteId);
  }

  markNoteDirty(noteId) {
    return this.markDirty(noteId);
  }

  /** Mark every non-deleted note dirty so the next sync uploads local content (e.g. after sign-in). */
  markAllActiveNotesDirty() {
    this.db
      .prepare(
        "UPDATE notes SET dirty = 1, sync_state = 'pending', updated_at = ? WHERE deleted = 0",
      )
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
      .prepare(
        `
        INSERT INTO pending_attachments(id, file_name, mime_type, local_path, workspace_id, document_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
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
      .prepare(
        `
        INSERT INTO keyboard_shortcuts(action, shortcut)
        VALUES (?, ?)
        ON CONFLICT(action) DO UPDATE SET shortcut = excluded.shortcut
      `,
      )
      .run(action, shortcut);
  }

  setIsTemplate(noteId, isTemplate) {
    this.db
      .prepare("UPDATE notes SET is_template = ? WHERE id = ?")
      .run(isTemplate ? 1 : 0, noteId);
  }

  updatePlainText(noteId, plainText) {
    this.db
      .prepare("UPDATE notes SET plain_text = ?, updated_at = ? WHERE id = ?")
      .run(plainText ?? "", new Date().toISOString(), noteId);
  }

  listTemplates() {
    return this.db
      .prepare("SELECT * FROM notes WHERE is_template = 1 AND deleted = 0 ORDER BY updated_at DESC")
      .all();
  }

  listFolderPaths() {
    return this.db
      .prepare("SELECT path FROM folders ORDER BY path ASC")
      .all()
      .map((row) => row.path);
  }

  listFolderPathsByPrefix(pathPrefix) {
    return this.db
      .prepare("SELECT path FROM folders WHERE path = ? OR path LIKE ? ORDER BY path ASC")
      .all(pathPrefix, `${pathPrefix}/%`)
      .map((row) => row.path);
  }

  upsertFolder(pathValue) {
    this.db
      .prepare(
        `
        INSERT INTO folders(path)
        VALUES (?)
        ON CONFLICT(path) DO NOTHING
      `,
      )
      .run(pathValue);
  }

  deleteFolder(pathValue) {
    this.db.prepare("DELETE FROM folders WHERE path = ?").run(pathValue);
  }

  deleteFoldersByPrefix(pathPrefix) {
    this.db
      .prepare("DELETE FROM folders WHERE path = ? OR path LIKE ?")
      .run(pathPrefix, `${pathPrefix}/%`);
  }

  searchNotesByTitle(query) {
    const like = `%${query.replace(/[%_]/g, "\\$&")}%`;
    return this.db
      .prepare(
        "SELECT * FROM notes WHERE deleted = 0 AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 50",
      )
      .all(like);
  }
}
