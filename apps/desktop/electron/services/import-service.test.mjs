import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * In-memory MetadataStore mock (same as in note-store.test.mjs)
 */
function makeTestStore() {
  const rows = new Map();

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

const { ImportService } = await import("./import-service.mjs");

/** Lightweight mock that satisfies ImportService's noteStore interface. */
function makeNoteStore(metadataStore) {
  return {
    upsertFromImport({ id, path, title, isTemplate }) {
      metadataStore.upsertNote({
        id,
        path,
        title,
        isTemplate,
        deleted: false,
        pinned: false,
      });
      return metadataStore.getNoteById(id);
    },
    updatePlainText(id, text) {
      metadataStore.updatePlainText(id, text);
    },
    listNotes() {
      return metadataStore.listNotes();
    },
  };
}

test("scanDirectory: finds .md files recursively", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slate-import-test-"));
  try {
    await writeFile(join(dir, "note1.md"), "# Hello\nWorld");
    await mkdir(join(dir, "projects"));
    await writeFile(join(dir, "projects", "note2.md"), "# Project Note");
    await mkdir(join(dir, "templates"));
    await writeFile(join(dir, "templates", "tmpl.md"), "# Template");

    const service = new ImportService({
      noteStore: makeNoteStore(makeTestStore()),
    });
    const found = await service.scanDirectory(dir);
    assert.equal(found.length, 3, "should find 3 md files");
    const paths = found.map((f) => f.relativePath);
    assert.ok(paths.includes("note1"), "should include note1");
    assert.ok(paths.includes("projects/note2"), "should include nested note");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("scanDirectory: marks templates/ files as isTemplate=true", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slate-import-test-"));
  try {
    await writeFile(join(dir, "note.md"), "# Note");
    await mkdir(join(dir, "templates"));
    await writeFile(join(dir, "templates", "tmpl.md"), "# Template");

    const service = new ImportService({
      noteStore: makeNoteStore(makeTestStore()),
    });
    const found = await service.scanDirectory(dir);
    const tmpl = found.find((f) => f.relativePath.startsWith("templates/"));
    assert.ok(tmpl, "should find template");
    assert.equal(tmpl.isTemplate, true);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("importDirectory: creates notes in NoteStore with correct titles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slate-import-test-"));
  const store = makeTestStore();
  try {
    await writeFile(join(dir, "doc.md"), "# My Doc\nSome content here.");
    await writeFile(join(dir, "untitled.md"), "No heading");

    const noteStore = makeNoteStore(store);
    const service = new ImportService({ noteStore });
    const result = await service.importDirectory(dir);

    assert.equal(result.total, 2);
    assert.equal(result.imported, 2);
    const notes = noteStore.listNotes();
    assert.equal(notes.length, 2);
    const docNote = notes.find((n) => n.title === "My Doc");
    assert.ok(docNote, "should extract title from h1 heading");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("importDirectory: returns count of imported notes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slate-import-test-"));
  const store = makeTestStore();
  try {
    await writeFile(join(dir, "a.md"), "# A");
    await writeFile(join(dir, "b.md"), "# B");
    await writeFile(join(dir, "c.md"), "# C");

    const noteStore = makeNoteStore(store);
    const service = new ImportService({ noteStore });
    const result = await service.importDirectory(dir);

    assert.equal(result.total, 3);
    assert.equal(result.imported, 3);
  } finally {
    await rm(dir, { recursive: true });
  }
});
