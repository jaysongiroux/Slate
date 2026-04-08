import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("resolveCollaborationUrl normalizes host-only and full HTTP endpoints", async () => {
  const { resolveCollaborationUrl } = await import("../../src/lib/backend-sync.mjs");

  assert.equal(resolveCollaborationUrl("localhost:4000"), "ws://localhost:4000/collaboration");
  assert.equal(
    resolveCollaborationUrl("http://localhost:4000"),
    "ws://localhost:4000/collaboration",
  );
  assert.equal(
    resolveCollaborationUrl("https://notes.example.com"),
    "wss://notes.example.com/collaboration",
  );
  assert.equal(
    resolveCollaborationUrl("https://notes.example.com/"),
    "wss://notes.example.com/collaboration",
  );
});

test("sync status helpers notify listeners and support unsubscribe", async () => {
  const { emitSyncStatus, listenForSyncStatus } = await import("../../src/lib/backend-sync.mjs");

  const target = new EventTarget();
  const seen = [];
  const unsubscribe = listenForSyncStatus(target, (status) => seen.push(status));

  emitSyncStatus(target, "syncing");
  emitSyncStatus(target, "idle");
  unsubscribe();
  emitSyncStatus(target, "error");

  assert.deepEqual(seen, ["syncing", "idle"]);
});

test("App passes the stored backend endpoint directly to SyncProvider", async () => {
  const appSource = await readFile(path.resolve(process.cwd(), "src/App.tsx"), "utf8");

  assert.match(appSource, /backendUrl=\{backendEndpoint \?\? null\}/);
  assert.doesNotMatch(appSource, /backendEndpoint\.replace\(/);
  assert.doesNotMatch(appSource, /:4000`/);
});
