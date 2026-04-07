import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ensureNoteCrdtState } from "./note-crdt-state.mjs";

const appRoot = process.cwd();

test("ensureNoteCrdtState bootstraps CRDT state from markdown when missing", async () => {
  const calls = [];
  const expectedState = Buffer.from([1, 2, 3, 4]);

  const state = await ensureNoteCrdtState({
    noteId: "note-1",
    workspaceService: {
      async loadNote(noteId) {
        calls.push(["loadNote", noteId]);
        return { id: noteId, markdown: "# Seeded\n\nLocal content\n" };
      },
    },
    ydocManager: {
      hasCrdtState(noteId) {
        calls.push(["hasCrdtState", noteId]);
        return false;
      },
      async bootstrapFromMarkdown(noteId, markdown) {
        calls.push(["bootstrapFromMarkdown", noteId, markdown]);
      },
      getFullState(noteId) {
        calls.push(["getFullState", noteId]);
        return expectedState;
      },
    },
  });

  assert.deepEqual(state, expectedState);
  assert.deepEqual(calls, [
    ["hasCrdtState", "note-1"],
    ["loadNote", "note-1"],
    ["bootstrapFromMarkdown", "note-1", "# Seeded\n\nLocal content\n"],
    ["getFullState", "note-1"],
  ]);
});

test("ensureNoteCrdtState reuses existing CRDT state without reloading markdown", async () => {
  const calls = [];
  const expectedState = Buffer.from([9, 9, 9]);

  const state = await ensureNoteCrdtState({
    noteId: "note-2",
    workspaceService: {
      async loadNote() {
        calls.push(["loadNote"]);
        return { markdown: "# Should not load\n" };
      },
    },
    ydocManager: {
      hasCrdtState(noteId) {
        calls.push(["hasCrdtState", noteId]);
        return true;
      },
      async bootstrapFromMarkdown() {
        calls.push(["bootstrapFromMarkdown"]);
      },
      getFullState(noteId) {
        calls.push(["getFullState", noteId]);
        return expectedState;
      },
    },
  });

  assert.deepEqual(state, expectedState);
  assert.deepEqual(calls, [
    ["hasCrdtState", "note-2"],
    ["getFullState", "note-2"],
  ]);
});

test("desktop note hydration wiring exposes note CRDT state to the renderer", async () => {
  const [mainSource, preloadSource, apiSource, syncProviderSource, editorSource] =
    await Promise.all([
      readFile(path.join(appRoot, "electron/main.mjs"), "utf8"),
      readFile(path.join(appRoot, "electron/preload.mjs"), "utf8"),
      readFile(path.join(appRoot, "src/lib/api.ts"), "utf8"),
      readFile(path.join(appRoot, "src/lib/sync-provider.tsx"), "utf8"),
      readFile(path.join(appRoot, "src/components/NovelEditor.tsx"), "utf8"),
    ]);

  assert.match(mainSource, /desktop:getNoteCrdtState/);
  assert.match(mainSource, /ensureNoteCrdtState/);

  assert.match(
    preloadSource,
    /getNoteCrdtState:\s*\(noteId\)\s*=>\s*ipcRenderer\.invoke\("desktop:getNoteCrdtState", noteId\)/,
  );

  assert.match(apiSource, /getNoteCrdtState\(noteId: string\): Promise<Uint8Array \| null>/);
  assert.match(apiSource, /async getNoteCrdtState\(noteId: string\)/);
  assert.match(apiSource, /export function getNoteCrdtState\(noteId: string\)/);

  assert.match(syncProviderSource, /getNoteCrdtState\(noteId\)/);
  assert.match(syncProviderSource, /Y\.applyUpdate\(ydoc, new Uint8Array\(crdtState\)\)/);
  assert.match(editorSource, /field:\s*"prosemirror"/);
});
