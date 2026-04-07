import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();

test("main process wires CRDT reset events for renderer reloads", async () => {
  const mainSource = await readFile(path.join(appRoot, "electron/main.mjs"), "utf8");

  assert.match(mainSource, /workspaceService\.sendCrdtStateReset\s*=/);
  assert.match(mainSource, /syncService\.sendCrdtStateReset\s*=/);
  assert.match(mainSource, /desktop:noteCrdtStateReset/);
});

test("renderer listens for note CRDT reset events", async () => {
  const [preloadSource, syncProviderSource] = await Promise.all([
    readFile(path.join(appRoot, "electron/preload.mjs"), "utf8"),
    readFile(path.join(appRoot, "src/lib/sync-provider.tsx"), "utf8"),
  ]);

  assert.match(preloadSource, /onNoteCrdtStateReset:\s*\(callback\)\s*=>/);
  assert.match(preloadSource, /offNoteCrdtStateReset:\s*\(\)\s*=>/);
  assert.match(syncProviderSource, /onNoteCrdtStateReset/);
  assert.match(syncProviderSource, /setResetKey\(\(current\)\s*=>\s*current \+ 1\)/);
});

test("app auto-reloads open notes from workspace changes and removes the manual filesystem toggle", async () => {
  const [appSource, settingsSource, fileWatcherSource] = await Promise.all([
    readFile(path.join(appRoot, "src/App.tsx"), "utf8"),
    readFile(path.join(appRoot, "src/components/SettingsDialog.tsx"), "utf8"),
    readFile(path.join(appRoot, "electron/services/file-watcher.mjs"), "utf8"),
  ]);

  assert.doesNotMatch(appSource, /autoReconcileFilesystem/);
  assert.doesNotMatch(settingsSource, /Auto-load external file changes/);
  assert.doesNotMatch(fileWatcherSource, /autoReconcileFilesystem/);

  assert.match(appSource, /reloadSelectedNoteFromDisk/);
  assert.match(appSource, /reloadSelectedNoteFromDisk\(current\.id\)/);
  assert.doesNotMatch(appSource, /Save or reload to resolve differences/);
});

test("workspace watcher watches the workspace root and filters to markdown files", async () => {
  const workspaceSource = await readFile(
    path.join(appRoot, "electron/services/workspace-service.mjs"),
    "utf8",
  );

  assert.match(workspaceSource, /watchTarget\s*=\s*this\.workspaceRoot/);
  assert.match(workspaceSource, /chokidar\.watch\(watchTarget/);
  assert.match(workspaceSource, /ignored:\s*\(watchedPath,\s*stats\)\s*=>/);
  assert.match(workspaceSource, /path\.extname\(watchedPath\)\.toLowerCase\(\)\s*!==\s*"\.md"/);
  assert.doesNotMatch(workspaceSource, /path\.join\(this\.workspaceRoot,\s*"\*\.md"\)/);
  assert.doesNotMatch(workspaceSource, /path\.join\(this\.workspaceRoot,\s*"\*\*\/\*\.md"\)/);
  assert.match(workspaceSource, /usePolling:\s*true/);
  assert.match(workspaceSource, /awaitWriteFinish:\s*\{/);
  assert.match(workspaceSource, /stabilityThreshold:\s*250/);
  assert.match(workspaceSource, /pollInterval:\s*100/);
  assert.match(workspaceSource, /atomic:\s*200/);
});
