import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { sha256Utf8 } from "./disk-content-hash.mjs";
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
    replaceFromMarkdown: async () => {},
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

test("indexWorkspace refreshes CRDT state for externally edited files on startup reconcile", async () => {
  const userDataPath = await makeTempDir("slate-userdata-");
  const workspaceRoot = await makeTempDir("slate-workspace-");
  const metadataStore = new MetadataStore(userDataPath);
  const ydocCalls = [];
  const service = new WorkspaceService({
    metadataStore,
    defaultWorkspaceRoot: workspaceRoot,
    ydocManager: {
      release() {},
      bootstrapFromMarkdown: async () => {},
      replaceFromMarkdown: async (noteId, markdown) => {
        ydocCalls.push({ type: "replace", noteId, markdown });
      },
    },
  });

  try {
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

    assert.deepEqual(ydocCalls, [
      {
        type: "replace",
        noteId: "edited",
        markdown: "# Updated title\nBody",
      },
    ]);
  } finally {
    if (service.watcher) {
      await service.watcher.close();
    }
    await fs.rm(userDataPath, { recursive: true, force: true });
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("indexWorkspace bootstraps CRDT state for new files discovered on startup", async () => {
  const userDataPath = await makeTempDir("slate-userdata-");
  const workspaceRoot = await makeTempDir("slate-workspace-");
  const metadataStore = new MetadataStore(userDataPath);
  const ydocCalls = [];
  const service = new WorkspaceService({
    metadataStore,
    defaultWorkspaceRoot: workspaceRoot,
    ydocManager: {
      release() {},
      replaceFromMarkdown: async () => {},
      bootstrapFromMarkdown: async (noteId, markdown) => {
        ydocCalls.push({ type: "bootstrap", noteId, markdown });
      },
    },
  });

  try {
    await fs.writeFile(path.join(workspaceRoot, "new-note.md"), "# New note\nBody", "utf8");

    await service.indexWorkspace();

    assert.equal(ydocCalls.length, 1);
    assert.equal(ydocCalls[0]?.type, "bootstrap");
    assert.equal(ydocCalls[0]?.markdown, "# New note\nBody");

    const row = metadataStore.getNoteByPath("new-note.md");
    assert.ok(row);
    assert.equal(ydocCalls[0]?.noteId, row.id);
  } finally {
    if (service.watcher) {
      await service.watcher.close();
    }
    await fs.rm(userDataPath, { recursive: true, force: true });
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("indexWorkspace does not re-dirty clean notes when file mtime is newer than updated_at but hash matches", async () => {
  await withWorkspaceTest(async ({ service, metadataStore, workspaceRoot }) => {
    const body = "# Stable\n\nSame bytes.\n";
    const filePath = path.join(workspaceRoot, "stable.md");
    await fs.writeFile(filePath, body, "utf8");

    metadataStore.upsertNote({
      id: "stable",
      relativePath: "stable.md",
      title: "Stable",
      serverSeq: 3,
      syncState: "idle",
      dirty: 0,
      deleted: 0,
      updatedAt: "2000-01-01T00:00:00.000Z",
      diskContentHash: sha256Utf8(body),
      diskMtimeMs: Date.now(),
      diskSize: Buffer.byteLength(body, "utf8"),
    });

    await fs.writeFile(filePath, body, "utf8");

    await service.indexWorkspace();

    const row = metadataStore.getNoteById("stable");
    assert.equal(row.dirty, 0);
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

test("metadata store persists reminder settings and prunes stale fired reminders", async () => {
  await withWorkspaceTest(async ({ metadataStore }) => {
    metadataStore.setCalendarReminderSettings({
      enabled: true,
      minutesBeforeStart: 15,
      playSound: false,
      enabledCalendarIds: ["cal-1"],
    });

    const settings = metadataStore.getCalendarReminderSettings();
    assert.deepEqual(settings, {
      enabled: true,
      minutesBeforeStart: 15,
      playSound: false,
      enabledCalendarIds: ["cal-1"],
    });

    metadataStore.setCalendarReminderFired(
      {
        stale: { firedAt: "2000-01-01T00:00:00.000Z" },
        fresh: { firedAt: new Date().toISOString() },
      },
      Date.now(),
    );

    const fired = metadataStore.getCalendarReminderFired(Date.now());
    assert.deepEqual(Object.keys(fired), ["fresh"]);
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

    const oldExists = await fs.stat(path.join(workspaceRoot, "old-name.md")).then(
      () => true,
      () => false,
    );
    const newContent = await fs.readFile(path.join(workspaceRoot, "renamed.md"), "utf8");
    const row = metadataStore.getNoteById("note-1");

    assert.equal(oldExists, false);
    assert.equal(newContent, "# Renamed\n");
    assert.equal(row.relative_path, "renamed.md");
    assert.equal(row.server_seq, 5);
  });
});

test("moveNote relocates file and updates metadata", async () => {
  await withWorkspaceTest(async ({ service, metadataStore, workspaceRoot }) => {
    await fs.mkdir(path.join(workspaceRoot, "docs"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "root.md"), "# Root\n", "utf8");
    metadataStore.upsertNote({
      id: "movable",
      relativePath: "root.md",
      title: "Root",
      serverSeq: 2,
      syncState: "idle",
      dirty: 0,
      deleted: 0,
      updatedAt: new Date().toISOString(),
    });

    const moved = await service.moveNote("movable", "docs");
    assert.equal(moved.path, "docs/root.md");
    const row = metadataStore.getNoteById("movable");
    assert.equal(row.relative_path, "docs/root.md");
    const atRoot = await fs.stat(path.join(workspaceRoot, "root.md")).then(
      () => true,
      () => false,
    );
    const inDocs = await fs.readFile(path.join(workspaceRoot, "docs/root.md"), "utf8");
    assert.equal(atRoot, false);
    assert.equal(inDocs, "# Root\n");
  });
});

test("moveNote moves note to workspace root", async () => {
  await withWorkspaceTest(async ({ service, metadataStore, workspaceRoot }) => {
    await fs.mkdir(path.join(workspaceRoot, "inbox"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "inbox/task.md"), "# Task\n", "utf8");
    metadataStore.upsertNote({
      id: "t1",
      relativePath: "inbox/task.md",
      title: "Task",
      serverSeq: 1,
      syncState: "idle",
      dirty: 0,
      deleted: 0,
      updatedAt: new Date().toISOString(),
    });

    await service.moveNote("t1", "");
    const row = metadataStore.getNoteById("t1");
    assert.equal(row.relative_path, "task.md");
    const existsAtRoot = await fs.readFile(path.join(workspaceRoot, "task.md"), "utf8");
    assert.equal(existsAtRoot, "# Task\n");
  });
});

test("moveFolder relocates directory and note paths", async () => {
  await withWorkspaceTest(async ({ service, metadataStore, workspaceRoot }) => {
    await fs.mkdir(path.join(workspaceRoot, "alpha", "nest"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "alpha", "nest", "n.md"), "# N\n", "utf8");
    metadataStore.upsertNote({
      id: "n1",
      relativePath: "alpha/nest/n.md",
      title: "N",
      serverSeq: 1,
      syncState: "idle",
      dirty: 0,
      deleted: 0,
      updatedAt: new Date().toISOString(),
    });

    await fs.mkdir(path.join(workspaceRoot, "beta"), { recursive: true });
    await service.moveFolder("alpha/nest", "beta");

    const row = metadataStore.getNoteById("n1");
    assert.equal(row.relative_path, "beta/nest/n.md");
    const content = await fs.readFile(path.join(workspaceRoot, "beta", "nest", "n.md"), "utf8");
    assert.equal(content, "# N\n");
  });
});

test("reconcileDiskFromHashes picks up new files without watcher events", async () => {
  await withWorkspaceTest(async ({ service, metadataStore, workspaceRoot }) => {
    await fs.writeFile(path.join(workspaceRoot, "orphan.md"), "# Orphan\n", "utf8");
    const changed = await service.reconcileDiskFromHashes();
    assert.equal(changed, true);
    const row = metadataStore.getNoteByPath("orphan.md");
    assert.ok(row);
    assert.equal(row.dirty, 1);
    assert.ok(row.disk_content_hash);
  });
});
