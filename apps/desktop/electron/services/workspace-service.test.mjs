import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MetadataStore } from "./metadata-store.mjs";
import { WorkspaceService } from "./workspace-service.mjs";

async function makeTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function withWorkspaceTest(fn) {
  const userDataPath = await makeTempDir("slate-userdata-");
  const workspaceRoot = await makeTempDir("slate-workspace-");
  const metadataStore = new MetadataStore(userDataPath);
  const ydocManager = {
    release() {},
    bootstrapFromMarkdown: async () => {},
    getFullState: () => new Uint8Array(),
    hasCrdtState: () => false,
  };
  const service = new WorkspaceService({
    metadataStore,
    defaultWorkspaceRoot: workspaceRoot,
    ydocManager,
  });

  try {
    await fn({ service, metadataStore, workspaceRoot });
  } finally {
    if (service.watcher) {
      await service.watcher.close();
    }
    await fs.rm(userDataPath, { recursive: true, force: true });
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("indexWorkspace marks notes missing from disk as deleted and dirty", async () => {
  await withWorkspaceTest(async ({ service, metadataStore, workspaceRoot }) => {
    await fs.writeFile(path.join(workspaceRoot, "kept.md"), "# Kept\n", "utf8");

    metadataStore.upsertNote({
      id: "kept",
      relativePath: "kept.md",
      title: "Kept",
      serverSeq: 3,
      syncState: "idle",
      dirty: 0,
      deleted: 0,
      updatedAt: new Date().toISOString(),
    });
    metadataStore.upsertNote({
      id: "gone",
      relativePath: "gone.md",
      title: "Gone",
      serverSeq: 7,
      syncState: "idle",
      dirty: 0,
      deleted: 0,
      updatedAt: new Date().toISOString(),
    });

    await service.indexWorkspace();

    const goneRow = metadataStore.getNoteById("gone");
    assert.equal(goneRow.deleted, 1);
    assert.equal(goneRow.dirty, 1);
  });
});

test("indexWorkspace marks externally edited files as dirty on startup reconcile", async () => {
  await withWorkspaceTest(async ({ service, metadataStore, workspaceRoot }) => {
    const filePath = path.join(workspaceRoot, "edited.md");
    await fs.writeFile(filePath, "# Updated title\nBody", "utf8");

    metadataStore.upsertNote({
      id: "edited",
      relativePath: "edited.md",
      title: "Original title",
      serverSeq: 11,
      syncState: "idle",
      dirty: 0,
      deleted: 0,
      updatedAt: "2000-01-01T00:00:00.000Z",
    });

    await service.indexWorkspace();

    const editedRow = metadataStore.getNoteById("edited");
    assert.equal(editedRow.dirty, 1);
    assert.equal(editedRow.deleted, 0);
    assert.equal(editedRow.title, "Updated title");
  });
});

test("metadata store persists server sequence for notes", async () => {
  await withWorkspaceTest(async ({ metadataStore }) => {
    metadataStore.upsertNote({
      id: "server-seq-note",
      relativePath: "server-seq-note.md",
      title: "Server Seq",
      serverSeq: 9,
      syncState: "idle",
      dirty: 0,
      deleted: 0,
      updatedAt: new Date().toISOString(),
    });

    const row = metadataStore.getNoteById("server-seq-note");
    assert.equal(row.server_seq, 9);
  });
});

test("writeRemoteNote rewrites the local path for an existing note id", async () => {
  await withWorkspaceTest(async ({ service, metadataStore, workspaceRoot }) => {
    await fs.writeFile(path.join(workspaceRoot, "old-name.md"), "# Original\n", "utf8");

    metadataStore.upsertNote({
      id: "note-1",
      relativePath: "old-name.md",
      title: "Original",
      serverSeq: 4,
      syncState: "idle",
      dirty: 0,
      deleted: 0,
      updatedAt: new Date().toISOString(),
    });

    await service.writeRemoteNote({
      id: "note-1",
      path: "renamed.md",
      title: "Renamed",
      markdown: "# Renamed\n",
      serverSeq: 5,
    });

    const oldExists = await fs.stat(path.join(workspaceRoot, "old-name.md")).then(() => true, () => false);
    const newContent = await fs.readFile(path.join(workspaceRoot, "renamed.md"), "utf8");
    const row = metadataStore.getNoteById("note-1");

    assert.equal(oldExists, false);
    assert.equal(newContent, "# Renamed\n");
    assert.equal(row.relative_path, "renamed.md");
    assert.equal(row.server_seq, 5);
  });
});
