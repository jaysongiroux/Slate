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
