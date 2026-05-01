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

test("App reads backend endpoint from the sync store without manipulation", async () => {
  const appSource = await readFile(path.resolve(process.cwd(), "src/App.tsx"), "utf8");

  assert.match(appSource, /useSyncStore/);
  assert.match(appSource, /backendEndpoint/);
  assert.doesNotMatch(appSource, /backendEndpoint\.replace\(/);
  assert.doesNotMatch(appSource, /:4000`/);
});

test("backend auth actions control RxDB replication lifecycle", async () => {
  const [appSource, backendActionsSource] = await Promise.all([
    readFile(path.resolve(process.cwd(), "src/App.tsx"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/hooks/useBackendActions.ts"), "utf8"),
  ]);

  assert.match(appSource, /useDatabaseReplicationControl/);
  assert.match(appSource, /restartReplication/);
  assert.match(appSource, /cancelReplication/);
  assert.match(backendActionsSource, /restartReplication:\s*\(\)\s*=>\s*Promise<void>/);
  assert.match(backendActionsSource, /cancelReplication:\s*\(\)\s*=>\s*void/);

  assert.match(
    backendActionsSource,
    /async function handleLogin\(\)[\s\S]*await restartReplication\(\)[\s\S]*password_login_ok/,
  );
  assert.match(
    backendActionsSource,
    /async function handleOidcLogin\(providerId: string\)[\s\S]*await restartReplication\(\)[\s\S]*oidc_login_ok/,
  );
  assert.match(
    backendActionsSource,
    /async function handleFullSync\(\)[\s\S]*await restartReplication\(\)[\s\S]*toast\.success\("Refreshed"\)/,
  );
  assert.match(
    backendActionsSource,
    /async function handleSignOut\(\)[\s\S]*cancelReplication\(\)[\s\S]*sign_out_complete/,
  );
  assert.match(
    backendActionsSource,
    /async function handleSaveEndpoint\(\)[\s\S]*const savedBackend = await setBackendEndpoint\(endpoint\)[\s\S]*cancelReplication\(\)/,
  );
});

test("DatabaseProvider normalizes backend endpoint before starting RxDB replication", async () => {
  const providerSource = await readFile(
    path.resolve(process.cwd(), "src/db/DatabaseProvider.tsx"),
    "utf8",
  );

  assert.match(providerSource, /resolveBackendBaseUrl/);
  assert.match(providerSource, /const backendUrl = resolveBackendBaseUrl\(backendEndpoint\)/);
  assert.match(providerSource, /backendUrl,/);
});

test("RxDB replication checkpoint is scoped to backend and authenticated user", async () => {
  const [providerSource, replicationSource] = await Promise.all([
    readFile(path.resolve(process.cwd(), "src/db/DatabaseProvider.tsx"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/db/replication.ts"), "utf8"),
  ]);

  assert.match(providerSource, /authenticatedUserId/);
  assert.match(providerSource, /replicationScope/);
  assert.match(providerSource, /replicationScope,/);

  assert.match(replicationSource, /replicationScope: string/);
  assert.match(
    replicationSource,
    /replicationIdentifier: `slate-\$\{collectionName\}-replication-\$\{config\.replicationScope\}`/,
  );
});

test("RxDB note replication logs push, pull, and stream diagnostics", async () => {
  const replicationSource = await readFile(
    path.resolve(process.cwd(), "src/db/replication.ts"),
    "utf8",
  );

  assert.match(replicationSource, /logReplicationDebug/);
  assert.match(replicationSource, /"stream-batch"/);
  assert.match(replicationSource, /"push-result"/);
  assert.match(replicationSource, /"pull-result"/);
  assert.match(replicationSource, /conflictCount/);
  assert.match(replicationSource, /ids:/);
});
