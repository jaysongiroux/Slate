import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * In-memory store that mimics the MetadataStore API used by NoteStore.
 * Avoids node:sqlite dependency (requires Node 22+).
 */
function makeTestStore() {
  const rows = new Map(); // id -> row
  const folders = new Map(); // path -> row

  function byPath(path) {
    for (const row of rows.values()) {
      if (row.relative_path === path) return row;
    }
    return null;
  }

  return {
    getNoteById: (id) => rows.get(id) ?? null,
    getNoteByPath: (path) => byPath(path),
    listNotes: () =>
      [...rows.values()]
        .filter((r) => r.deleted === 0)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    listTemplates: () => [...rows.values()].filter((r) => r.is_template === 1 && r.deleted === 0),
    isPathAvailable: (path) => {
      const existing = byPath(path);
      return !existing || existing.deleted === 1;
    },
    listNotesByPrefix: (prefix) =>
      [...rows.values()].filter(
        (r) => r.relative_path === prefix || r.relative_path.startsWith(`${prefix}/`),
      ),
    listFolderPaths: () => [...folders.keys()].sort(),
    listFolderPathsByPrefix: (prefix) =>
      [...folders.keys()].filter((path) => path === prefix || path.startsWith(`${prefix}/`)).sort(),
    upsertFolder(path) {
      folders.set(path, {
        path,
        created_at: new Date().toISOString(),
      });
    },
    deleteFolder(path) {
      folders.delete(path);
    },
    deleteFoldersByPrefix(prefix) {
      for (const folderPath of [...folders.keys()]) {
        if (folderPath === prefix || folderPath.startsWith(`${prefix}/`)) {
          folders.delete(folderPath);
        }
      }
    },
    markDeleted: (path) => {
      const row = byPath(path);
      if (row) {
        row.deleted = 1;
        row.updated_at = new Date().toISOString();
      }
    },
    setPinned: (id, val) => {
      const row = rows.get(id);
      if (row) row.pinned = val ? 1 : 0;
    },
    updatePlainText: (id, text) => {
      const row = rows.get(id);
      if (row) row.plain_text = text;
    },
    upsertNote(note) {
      const path = note.path ?? note.relativePath;
      const existing = rows.get(note.id);
      if (existing) {
        Object.assign(existing, {
          relative_path: path,
          title: note.title,
          is_template: note.isTemplate ? 1 : 0,
          deleted: note.deleted ? 1 : 0,
          pinned: note.pinned ? 1 : 0,
          updated_at: note.updatedAt ?? new Date().toISOString(),
        });
      } else {
        rows.set(note.id, {
          id: note.id,
          relative_path: path,
          title: note.title,
          is_template: note.isTemplate ? 1 : 0,
          plain_text: "",
          deleted: note.deleted ? 1 : 0,
          pinned: note.pinned ? 1 : 0,
          updated_at: note.updatedAt ?? new Date().toISOString(),
          created_at: note.createdAt ?? new Date().toISOString(),
        });
      }
    },
  };
}

const { NoteStore } = await import("./note-store.mjs");
const { MetadataStore } = await import("./metadata-store.mjs");

test("createNote: creates a note with unique ID and path", () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const note = noteStore.createNote({ parentPath: "" });
  assert.ok(note.id, "should have id");
  assert.ok(note.path.startsWith("untitled"), "path should start with untitled");
  assert.equal(note.title, "Untitled");
  assert.equal(note.deleted, false);
});

test("createNote: uses parent path as prefix", () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const note = noteStore.createNote({ parentPath: "projects" });
  assert.ok(note.path.startsWith("projects/"), "path should have projects/ prefix");
});

test("createNote: uses the provided name for the title and slug", () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const note = noteStore.createNote({ parentPath: "projects", name: "Launch Plan" });
  assert.equal(note.title, "Launch Plan");
  assert.equal(note.path, "projects/launch-plan");
});

test("createNote: avoids duplicate paths", () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const a = noteStore.createNote({ parentPath: "" });
  const b = noteStore.createNote({ parentPath: "" });
  assert.notEqual(a.path, b.path, "paths should be unique");
});

test("listNotes: returns non-deleted notes as summaries", () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  noteStore.createNote({ parentPath: "" });
  const notes = noteStore.listNotes();
  assert.equal(notes.length, 1);
  assert.ok("id" in notes[0] && "title" in notes[0] && "path" in notes[0]);
});

test("deleteNote: marks note as deleted", () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const note = noteStore.createNote({ parentPath: "" });
  noteStore.deleteNote(note.id);
  const after = noteStore.listNotes();
  assert.equal(after.length, 0, "deleted note should not appear in list");
});

test("moveNote: updates path", () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const note = noteStore.createNote({ parentPath: "" });
  const moved = noteStore.moveNote(note.id, "archive");
  assert.ok(moved.path.startsWith("archive/"), "path should start with archive/");
});

test("renameNote: updates path slug without changing the stored title", () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const note = noteStore.createNote({ parentPath: "" });
  const renamed = noteStore.renameNote(note.id, "My Design Doc");
  assert.equal(renamed.title, "Untitled");
  assert.ok(renamed.path.includes("my-design-doc"), "path slug should match title");
});

test("renameNote: keeps templates inside the templates folder", () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const template = noteStore.createTemplate({ name: "Weekly Review" });
  const renamed = noteStore.renameNote(template.id, "Client Handoff");
  assert.equal(renamed.title, "Weekly Review");
  assert.equal(renamed.path, "templates/client-handoff");
  assert.equal(renamed.isTemplate, true);
});

test("moveNote: preserves the current filename even when the title differs", () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const note = noteStore.createNote({ parentPath: "", name: "Initial Name" });
  store.upsertNote({
    id: note.id,
    path: note.path,
    title: "Heading Title",
    isTemplate: false,
    deleted: false,
    pinned: false,
    updatedAt: new Date().toISOString(),
    createdAt: note.createdAt,
  });

  const moved = noteStore.moveNote(note.id, "archive");
  assert.equal(moved.path, "archive/initial-name");
  assert.equal(moved.title, "Heading Title");
});

test("updateTitleFromContent: updates the stored title without changing the path", () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const note = noteStore.createNote({ parentPath: "", name: "Initial Name" });

  const updated = noteStore.updateTitleFromContent(note.id, "Show");

  assert.equal(updated.title, "Show");
  assert.equal(updated.path, "initial-name");
});

test("listFolders: derives folders from note paths", () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  noteStore.createNote({ parentPath: "projects" });
  noteStore.createNote({ parentPath: "projects/backend" });
  noteStore.createNote({ parentPath: "" });
  const folders = noteStore.listFolders();
  assert.ok(folders.includes("projects"), "should include projects");
  assert.ok(folders.includes("projects/backend"), "should include nested folder");
});

test("createFolder: persists an explicitly created empty folder", () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const folderPath = noteStore.createFolder("", "Project Plans");
  assert.equal(folderPath, "project-plans");
  assert.ok(noteStore.listFolders().includes("project-plans"));
});

test("createTemplate: uses the provided name for the title and slug", () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const template = noteStore.createTemplate({ name: "Weekly Review" });
  assert.equal(template.title, "Weekly Review");
  assert.equal(template.path, "templates/weekly-review");
});

test("createTemplate: persists a template with the sqlite-backed metadata store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slate-note-store-test-"));
  try {
    const metadataStore = new MetadataStore(dir);
    const noteStore = new NoteStore({ metadataStore });
    const template = noteStore.createTemplate();

    assert.equal(template.title, "Untitled Template");
    assert.equal(template.isTemplate, true);
    assert.ok(template.path.startsWith("templates/"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy note schema without created_at is repaired before creating notes and templates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slate-note-store-legacy-"));
  try {
    const db = new DatabaseSync(join(dir, "slate.db"));
    db.exec(`
      CREATE TABLE notes (
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
    db.close();

    const metadataStore = new MetadataStore(dir);
    const noteStore = new NoteStore({ metadataStore });

    const note = noteStore.createNote();
    const template = noteStore.createTemplate();
    const columns = metadataStore.db.prepare("PRAGMA table_info(notes)").all();
    const columnNames = columns.map((column) => column.name);

    assert.ok(columnNames.includes("created_at"));
    assert.ok(columnNames.includes("is_template"));
    assert.ok(columnNames.includes("plain_text"));
    assert.equal(note.isTemplate, false);
    assert.equal(template.isTemplate, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
