import test from "node:test";
import assert from "node:assert/strict";

import { SyncService } from "./sync-service.mjs";

function createMetadataStoreMock(rows) {
  const settings = new Map();
  const purged = [];
  return {
    settings,
    purged,
    getSetting(key, fallbackValue = null) {
      return settings.has(key) ? settings.get(key) : fallbackValue;
    },
    setSetting(key, value) {
      settings.set(key, value);
    },
    deleteSetting(key) {
      settings.delete(key);
    },
    listDeletedDirtyNotes() {
      return rows;
    },
    purgeNote(noteId) {
      purged.push(noteId);
    },
    listDirtyNotes() {
      return [];
    },
    listNotes() {
      return [];
    },
    updateNoteServerSeq() {},
  };
}

test("pushPendingNotes syncs deleted notes as tombstones and purges them locally", async () => {
  const deletedRows = [
    { id: "synced-doc", deleted: 1, relative_path: "synced-doc.md" },
  ];
  const metadataStore = createMetadataStoreMock(deletedRows);

  const calls = [];
  const backendClient = {
    async pushDocumentUpdate(payload) {
      calls.push(payload);
      return { serverSeq: 10, deleted: true, serverDelta: new Uint8Array() };
    },
    isUnauthenticatedError() {
      return false;
    },
  };

  const syncService = new SyncService({
    metadataStore,
    workspaceService: {},
    backendClient,
    ydocManager: {
      getFullState() {
        return new Uint8Array([9, 9, 9]);
      },
      release() {},
    },
  });

  await syncService.pushPendingNotes("client-1");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].deleted, true);
  assert.deepEqual(Array.from(calls[0].crdtUpdate), [9, 9, 9]);
  assert.deepEqual(metadataStore.purged, ["synced-doc"]);
});

test("syncNow uses pushDocumentUpdate and pullDocumentEvents with serverSeq state", async () => {
  const settings = new Map([
    ["backendReachable", true],
    ["authStatus", "authenticated"],
    ["clientId", "client-1"],
    ["authenticatedUserId", "user-1"],
    ["lastServerSeq", 2],
  ]);
  let dirtyRows = [{ id: "note-1", title: "Note 1", relative_path: "note-1.md", server_seq: 0 }];

  const metadataStore = {
    settings,
    getSetting(key, fallbackValue = null) {
      return settings.has(key) ? settings.get(key) : fallbackValue;
    },
    setSetting(key, value) {
      settings.set(key, value);
    },
    listDeletedDirtyNotes() {
      return [];
    },
    listDirtyNotes() {
      return dirtyRows;
    },
    getNoteById() {
      return { id: "note-1", relative_path: "note-1.md" };
    },
    updateNoteServerSeq(noteId, serverSeq) {
      settings.set(`serverSeq:${noteId}`, serverSeq);
      dirtyRows = [];
    },
    listPendingAttachments() {
      return [];
    },
  };

  const calls = { pushes: [], pulls: [] };
  const backendClient = {
    async pushDocumentUpdate(payload) {
      calls.pushes.push(payload);
      return { serverSeq: 3, path: payload.path, deleted: false, serverDelta: new Uint8Array() };
    },
    async pullDocumentEvents(payload) {
      calls.pulls.push(payload);
      return { documents: [], latestServerSeq: 3 };
    },
    isUnauthenticatedError() {
      return false;
    },
  };

  const syncService = new SyncService({
    metadataStore,
    workspaceService: {
      getWorkspaceProfile() { return { id: "local", name: "Local", rootPath: "/tmp", connected: true }; },
      listNotes: async () => [],
      listFolders: async () => [],
    },
    backendClient,
    ydocManager: {
      getUpdate() { return new Uint8Array([1, 2, 3]); },
      getStateVector() { return new Uint8Array([4, 5]); },
      applyUpdate() {},
      materializeMarkdown: async () => "# Note 1\n",
      getFullState() { return new Uint8Array([1, 2, 3]); },
    },
  });

  await syncService.syncNow();

  assert.equal(calls.pushes.length, 1);
  assert.equal(calls.pushes[0].documentId, "note-1");
  assert.equal(calls.pulls.length, 1);
  assert.equal(calls.pulls[0].sinceServerSeq, 2);
  assert.equal(settings.get("lastServerSeq"), 3);
});

test("syncInBackground swallows connectivity failures and marks backend unreachable", async () => {
  const settings = new Map([
    ["backendReachable", true],
    ["authStatus", "authenticated"],
    ["clientId", "client-1"],
    ["authenticatedUserId", "user-1"],
  ]);

  const metadataStore = {
    settings,
    getSetting(key, fallbackValue = null) {
      return settings.has(key) ? settings.get(key) : fallbackValue;
    },
    setSetting(key, value) {
      settings.set(key, value);
    },
    listDeletedDirtyNotes() {
      return [];
    },
    listDirtyNotes() {
      return [{ id: "note-1", relative_path: "note-1.md", deleted: 0 }];
    },
    listPendingAttachments() {
      return [];
    },
  };

  let status = null;
  const syncService = new SyncService({
    metadataStore,
    workspaceService: {
      onWorkspaceDirty() {},
      getWorkspaceProfile() { return { id: "local", name: "Local", rootPath: "/tmp", connected: true }; },
      listNotes: async () => [],
      listFolders: async () => [],
    },
    backendClient: {
      async pushDocumentUpdate() {
        const error = new Error("14 UNAVAILABLE: connect ECONNREFUSED 127.0.0.1:50051");
        error.code = 14;
        throw error;
      },
      isUnauthenticatedError() {
        return false;
      },
    },
    ydocManager: {
      getUpdate() { return new Uint8Array([1]); },
      getStateVector() { return new Uint8Array([2]); },
    },
  });

  syncService.sendSyncStatus = (nextStatus) => {
    status = nextStatus;
  };

  await syncService.syncInBackground();

  assert.equal(settings.get("backendReachable"), false);
  assert.equal(status, "error");
});
