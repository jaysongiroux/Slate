import { strict as assert } from "node:assert";
import { test } from "node:test";

/**
 * In-memory store that mimics the MetadataStore API used by NoteStore.
 * Avoids node:sqlite dependency (requires Node 22+).
 */
function makeTestStore() {
  const rows = new Map(); // id -> row

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

test("renameNote: updates title and path slug", () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const note = noteStore.createNote({ parentPath: "" });
  const renamed = noteStore.renameNote(note.id, "My Design Doc");
  assert.equal(renamed.title, "My Design Doc");
  assert.ok(renamed.path.includes("my-design-doc"), "path slug should match title");
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
