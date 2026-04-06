import test from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";

import { SyncService } from "./sync-service.mjs";

function minimalSyncService(metadataStore) {
  return new SyncService({
    metadataStore,
    workspaceService: { onWorkspaceDirty() {}, scheduleDirtyCallback() {} },
    backendClient: {},
    ydocManager: {},
  });
}

test("hasSessionForEndpoint treats localhost and 127.0.0.1 as the same backend", () => {
  const settings = new Map([
    ["backendEndpoint", "localhost:50051"],
    ["accessToken", "tok"],
    ["authSessionEndpoint", "127.0.0.1:50051"],
  ]);
  const metadataStore = {
    getSetting(key, fallbackValue = null) {
      return settings.has(key) ? settings.get(key) : fallbackValue;
    },
  };
  const syncService = minimalSyncService(metadataStore);
  assert.equal(syncService.hasSessionForEndpoint(), true);
});

test("hasSessionForEndpoint accepts legacy tokens when authSessionEndpoint was never stored", () => {
  const settings = new Map([
    ["backendEndpoint", "localhost:50051"],
    ["accessToken", "tok"],
  ]);
  const metadataStore = {
    getSetting(key, fallbackValue = null) {
      return settings.has(key) ? settings.get(key) : fallbackValue;
    },
  };
  const syncService = minimalSyncService(metadataStore);
  assert.equal(syncService.hasSessionForEndpoint(), true);
});

test("hasSessionForEndpoint rejects when both access and refresh tokens are missing", () => {
  const settings = new Map([
    ["backendEndpoint", "localhost:50051"],
    ["authSessionEndpoint", "localhost:50051"],
  ]);
  const metadataStore = {
    getSetting(key, fallbackValue = null) {
      return settings.has(key) ? settings.get(key) : fallbackValue;
    },
  };
  const syncService = minimalSyncService(metadataStore);
  assert.equal(syncService.hasSessionForEndpoint(), false);
});

test("hasSessionForEndpoint rejects when session was bound to a different host", () => {
  const settings = new Map([
    ["backendEndpoint", "other.example:50051"],
    ["accessToken", "tok"],
    ["authSessionEndpoint", "localhost:50051"],
  ]);
  const metadataStore = {
    getSetting(key, fallbackValue = null) {
      return settings.has(key) ? settings.get(key) : fallbackValue;
    },
  };
  const syncService = minimalSyncService(metadataStore);
  assert.equal(syncService.hasSessionForEndpoint(), false);
});

test("refreshBackendStatus preserves a same-endpoint session when only the refresh token remains", async () => {
  const settings = new Map([
    ["backendEndpoint", "localhost:50051"],
    ["refreshToken", "refresh-token"],
    ["authSessionEndpoint", "localhost:50051"],
    ["authStatus", "signed_out"],
  ]);
  const metadataStore = {
    getSetting(key, fallbackValue = null) {
      return settings.has(key) ? settings.get(key) : fallbackValue;
    },
    setSetting(key, value) {
      settings.set(key, value);
    },
    deleteSetting(key) {
      settings.delete(key);
    },
  };

  const calls = [];
  const syncService = new SyncService({
    metadataStore,
    workspaceService: {
      onWorkspaceDirty() {},
      getWorkspaceProfile() {
        return { name: "Local Profile" };
      },
    },
    backendClient: {
      async checkConnection(endpoint) {
        calls.push(["checkConnection", endpoint]);
      },
      async listAuthProviders(endpoint) {
        calls.push(["listAuthProviders", endpoint]);
        return { providers: [] };
      },
      async getCurrentSessionAt() {
        calls.push(["getCurrentSessionAt"]);
        throw new Error("getCurrentSessionAt should not be called when access token is missing");
      },
      async refreshTokensAt(endpoint, refreshToken) {
        calls.push(["refreshTokensAt", endpoint, refreshToken]);
        return {
          userId: "user-1",
          email: "person@example.com",
          displayName: "Person",
          isAdmin: false,
          tokens: {
            accessToken: "new-access-token",
            refreshToken: "new-refresh-token",
            expiresAtUnix: 123,
          },
        };
      },
      isUnauthenticatedError() {
        return false;
      },
    },
    ydocManager: {},
  });

  const backend = await syncService.refreshBackendStatus();

  assert.equal(backend.authStatus, "authenticated");
  assert.equal(settings.get("accessToken"), "new-access-token");
  assert.equal(settings.get("refreshToken"), "new-refresh-token");
  assert.deepEqual(calls, [
    ["checkConnection", "localhost:50051"],
    ["listAuthProviders", "localhost:50051"],
    ["refreshTokensAt", "localhost:50051", "refresh-token"],
  ]);
});

test("endpoint() trims stored backendEndpoint", () => {
  const settings = new Map([["backendEndpoint", "  localhost:50051  "]]);
  const metadataStore = {
    getSetting(key, fallbackValue = null) {
      return settings.has(key) ? settings.get(key) : fallbackValue;
    },
  };
  const syncService = minimalSyncService(metadataStore);
  assert.equal(syncService.endpoint(), "localhost:50051");
});

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
  const deletedRows = [{ id: "synced-doc", deleted: 1, relative_path: "synced-doc.md" }];
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
    workspaceService: { scheduleDirtyCallback() {} },
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
      getWorkspaceProfile() {
        return { id: "local", name: "Local", rootPath: "/tmp", connected: true };
      },
      listNotes: async () => [],
      listFolders: async () => [],
      refreshNoteDiskSnapshot() {},
      scheduleDirtyCallback() {},
    },
    backendClient,
    ydocManager: {
      getUpdate() {
        return new Uint8Array([1, 2, 3]);
      },
      getStateVector() {
        return new Uint8Array([4, 5]);
      },
      applyUpdate() {},
      materializeMarkdown: async () => "# Note 1\n",
      getFullState() {
        return new Uint8Array([1, 2, 3]);
      },
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
      getWorkspaceProfile() {
        return { id: "local", name: "Local", rootPath: "/tmp", connected: true };
      },
      listNotes: async () => [],
      listFolders: async () => [],
      refreshNoteDiskSnapshot() {},
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
      getUpdate() {
        return new Uint8Array([1]);
      },
      getStateVector() {
        return new Uint8Array([2]);
      },
    },
  });

  syncService.sendSyncStatus = (nextStatus) => {
    status = nextStatus;
  };

  await syncService.syncInBackground();

  assert.equal(settings.get("backendReachable"), false);
  assert.equal(status, "error");
});

test("pushPendingNotes returns the set of successfully pushed (non-deleted) note IDs", async () => {
  const dirtyRows = [
    { id: "note-a", deleted: 0, relative_path: "note-a.md" },
    { id: "note-b", deleted: 0, relative_path: "note-b.md" },
  ];
  const deletedRows = [{ id: "note-del", deleted: 1, relative_path: "note-del.md" }];

  const metadataStore = {
    ...createMetadataStoreMock([]),
    listDirtyNotes: () => dirtyRows,
    listDeletedDirtyNotes: () => deletedRows,
    getNoteById: (id) => ({ id, relative_path: `${id}.md` }),
    updateNoteServerSeq() {},
  };

  const syncService = new SyncService({
    metadataStore,
    workspaceService: {
      scheduleDirtyCallback() {},
      refreshNoteDiskSnapshot() {},
      writeMarkdownFile: async () => {},
    },
    backendClient: {
      async pushDocumentUpdate() {
        return { serverSeq: 5, deleted: false, serverDelta: new Uint8Array() };
      },
      isUnauthenticatedError: () => false,
    },
    ydocManager: {
      getUpdate: () => new Uint8Array([1]),
      getStateVector: () => new Uint8Array([2]),
      getFullState: () => new Uint8Array([3]),
      applyUpdate() {},
      materializeMarkdown: async () => "# test\n",
      release() {},
    },
  });

  const result = await syncService.pushPendingNotes("client-1");

  assert.ok(result instanceof Set);
  assert.ok(result.has("note-a"));
  assert.ok(result.has("note-b"));
  assert.ok(!result.has("note-del"), "deleted notes should not be in the pushed set");
});

test("pullRemoteEvents skips notes in the exclusion set", async () => {
  // Build a valid CRDT state to use in the mock pull response
  const tmpDoc = new Y.Doc();
  tmpDoc.getText("content").insert(0, "hello");
  const validCrdtState = Y.encodeStateAsUpdate(tmpDoc);
  tmpDoc.destroy();

  const metadataStore = {
    ...createMetadataStoreMock([]),
    getNoteById: () => ({ id: "note-1", dirty: 0 }),
  };
  metadataStore.settings.set("lastServerSeq", 0);

  const resets = [];
  const replaced = [];

  const syncService = new SyncService({
    metadataStore,
    workspaceService: {
      scheduleDirtyCallback() {},
      writeRemoteNote: async () => {},
    },
    backendClient: {
      async pullDocumentEvents() {
        return {
          documents: [
            { documentId: "note-1", serverSeq: 5, crdtState: validCrdtState },
            { documentId: "note-2", serverSeq: 6, crdtState: validCrdtState },
          ],
          latestServerSeq: 6,
        };
      },
      isUnauthenticatedError: () => false,
    },
    ydocManager: {
      replaceFromState(id) { replaced.push(id); return new Y.Doc(); },
      materializeMarkdown: async () => "# test\n",
    },
  });
  syncService.sendCrdtStateReset = (id) => resets.push(id);

  await syncService.pullRemoteEvents("client-1", { skipNoteIds: new Set(["note-1"]) });

  assert.ok(!resets.includes("note-1"), "skipped note should not get a crdtStateReset");
  assert.ok(!replaced.includes("note-1"), "skipped note Y.Doc should not be replaced");
  assert.ok(resets.includes("note-2"), "non-skipped note should get a crdtStateReset");
  assert.ok(replaced.includes("note-2"), "non-skipped note Y.Doc should be replaced from server state");
});

test("pullRemoteEvents skips the activeNoteId and regresses lastServerSeq", async () => {
  const tmpDoc = new Y.Doc();
  tmpDoc.getText("content").insert(0, "hello");
  const validCrdtState = Y.encodeStateAsUpdate(tmpDoc);
  tmpDoc.destroy();

  const metadataStore = {
    ...createMetadataStoreMock([]),
    getNoteById: () => ({ id: "note-1", dirty: 0 }),
  };
  metadataStore.settings.set("lastServerSeq", 0);

  const resets = [];

  const syncService = new SyncService({
    metadataStore,
    workspaceService: {
      scheduleDirtyCallback() {},
      writeRemoteNote: async () => {},
    },
    backendClient: {
      async pullDocumentEvents() {
        return {
          documents: [
            { documentId: "active-note", serverSeq: 5, crdtState: validCrdtState },
            { documentId: "other-note", serverSeq: 8, crdtState: validCrdtState },
          ],
          latestServerSeq: 8,
        };
      },
      isUnauthenticatedError: () => false,
    },
    ydocManager: {
      replaceFromState() { return new Y.Doc(); },
      materializeMarkdown: async () => "# test\n",
    },
  });
  syncService.sendCrdtStateReset = (id) => resets.push(id);
  syncService.setActiveNoteId("active-note");

  await syncService.pullRemoteEvents("client-1");

  assert.ok(!resets.includes("active-note"), "active note should not get a crdtStateReset");
  assert.ok(resets.includes("other-note"), "non-active note should be processed");
  // lastServerSeq should regress to activeNote.serverSeq - 1 = 4
  // so the server re-sends the active note on the next pull
  assert.equal(metadataStore.settings.get("lastServerSeq"), 4);
});

test("runSyncNow threads pushed note IDs to pullRemoteEvents preventing destructive reset", async () => {
  const settings = new Map([
    ["backendReachable", true],
    ["authStatus", "authenticated"],
    ["clientId", "client-1"],
    ["authenticatedUserId", "user-1"],
    ["lastServerSeq", 0],
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
    listDeletedDirtyNotes: () => [],
    listDirtyNotes: () => dirtyRows,
    getNoteById: () => ({ id: "note-1", relative_path: "note-1.md", dirty: 0 }),
    updateNoteServerSeq(noteId, serverSeq) {
      settings.set(`serverSeq:${noteId}`, serverSeq);
      dirtyRows = [];
    },
    listPendingAttachments: () => [],
  };

  const resets = [];
  const syncService = new SyncService({
    metadataStore,
    workspaceService: {
      getWorkspaceProfile: () => ({ id: "local", name: "Local", rootPath: "/tmp", connected: true }),
      listNotes: async () => [],
      listFolders: async () => [],
      refreshNoteDiskSnapshot() {},
      scheduleDirtyCallback() {},
      writeRemoteNote: async () => {},
      writeMarkdownFile: async () => {},
    },
    backendClient: {
      async pushDocumentUpdate() {
        return { serverSeq: 3, path: "note-1.md", deleted: false, serverDelta: new Uint8Array() };
      },
      async pullDocumentEvents() {
        // Server returns the same note that was just pushed
        return {
          documents: [
            { documentId: "note-1", serverSeq: 3, crdtState: new Uint8Array([1, 2, 3]) },
          ],
          latestServerSeq: 3,
        };
      },
      isUnauthenticatedError: () => false,
    },
    ydocManager: {
      getUpdate: () => new Uint8Array([1, 2, 3]),
      getStateVector: () => new Uint8Array([4, 5]),
      getFullState: () => new Uint8Array([1, 2, 3]),
      applyUpdate() {},
      materializeMarkdown: async () => "# Note 1\n",
      replaceFromState() { return new Y.Doc(); },
    },
  });
  syncService.sendCrdtStateReset = (id) => resets.push(id);

  await syncService.syncNow();

  assert.ok(
    !resets.includes("note-1"),
    "recently-pushed note must not be destructively reset during pull",
  );
});

test("syncNow skips RPC when there is no local work and pull interval has not elapsed", async () => {
  const settings = new Map([
    ["backendReachable", true],
    ["authStatus", "authenticated"],
    ["clientId", "client-1"],
    ["authenticatedUserId", "user-1"],
    ["lastServerSeq", 0],
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
      return [];
    },
    listPendingAttachments() {
      return [];
    },
  };

  let pulls = 0;
  const syncService = new SyncService({
    metadataStore,
    workspaceService: {
      getWorkspaceProfile() {
        return { id: "local", name: "Local", rootPath: "/tmp", connected: true };
      },
      listNotes: async () => [],
      listFolders: async () => [],
      refreshNoteDiskSnapshot() {},
      reconcileDiskFromHashes: async () => false,
    },
    backendClient: {
      async pullDocumentEvents() {
        pulls += 1;
        return { documents: [], latestServerSeq: 0 };
      },
      isUnauthenticatedError() {
        return false;
      },
    },
    ydocManager: {},
  });

  syncService.lastPullAtMs = Date.now();

  await syncService.syncNow({ forceFull: false });

  assert.equal(pulls, 0);

  await syncService.syncNow({ forceFull: true });

  assert.equal(pulls, 1);
});
