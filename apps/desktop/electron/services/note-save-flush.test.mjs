import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();

test("note editor flushes a pending content save before unmounting", async () => {
  const editorSource = await readFile(path.join(appRoot, "src/components/NovelEditor.tsx"), "utf8");

  assert.match(editorSource, /flushPendingEditorSave/);
  assert.match(editorSource, /void flushPendingEditorSave\(saveTargetId\)/);
  assert.doesNotMatch(editorSource, /Drop pending debounced saves/);
});

test("note editor flushes the pending note snapshot instead of the live editor ref", async () => {
  const editorSource = await readFile(path.join(appRoot, "src/components/NovelEditor.tsx"), "utf8");

  assert.match(editorSource, /pendingEditorSaveRef/);
  assert.match(editorSource, /pendingEditorSaveRef\.current = \{/);
  assert.match(editorSource, /snapshot\.noteId !== saveTargetId/);
  assert.match(editorSource, /content: snapshot\.content/);
  assert.doesNotMatch(
    editorSource,
    /const json = editor\.getJSON\(\);[\s\S]*await database\.notes\.upsert/,
  );
});
