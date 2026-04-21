import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();

test("slash command menu only activates at the start of a line", async () => {
  const editorSource = await readFile(path.join(appRoot, "src/components/NovelEditor.tsx"), "utf8");

  assert.match(editorSource, /suggestion:\s*{/);
  assert.match(editorSource, /startOfLine:\s*true/);
});

test("slash command menu captures navigation keys before the editor moves the cursor", async () => {
  const editorSource = await readFile(path.join(appRoot, "src/components/NovelEditor.tsx"), "utf8");

  assert.doesNotMatch(editorSource, /handleCommandNavigation/);
  assert.match(editorSource, /document\.querySelector\("#slash-command"\)/);
  assert.match(editorSource, /event\.preventDefault\(\)/);
  assert.match(editorSource, /event\.stopPropagation\(\)/);
  assert.match(editorSource, /dispatchEvent\(\s*new KeyboardEvent\("keydown"/);
});
