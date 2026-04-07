import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { slateMarkdownParser } from "@slate/shared";

const appRoot = process.cwd();

test("shared markdown parser recognizes GFM task items with dash prefixes", () => {
  const doc = slateMarkdownParser.parse("- [ ] import button\n- [x] convert to tailwind\n");
  assert.ok(doc);

  const firstList = doc.content.firstChild;
  assert.equal(firstList.type.name, "bullet_list");

  const firstItem = firstList.firstChild;
  const secondItem = firstList.child(1);

  assert.equal(firstItem.type.name, "list_item");
  assert.equal(firstItem.attrs.checked, false);
  assert.equal(secondItem.attrs.checked, true);
});

test("paste as markdown wiring reads clipboard text and inserts parsed markdown into the editor", async () => {
  const [mainSource, preloadSource, editorSource] = await Promise.all([
    readFile(path.join(appRoot, "electron/main.mjs"), "utf8"),
    readFile(path.join(appRoot, "electron/preload.mjs"), "utf8"),
    readFile(path.join(appRoot, "src/components/NovelEditor.tsx"), "utf8"),
  ]);

  assert.match(mainSource, /clipboard\.readText\(\)/);
  assert.match(mainSource, /mainWindow\?\.webContents\.send\("desktop:pasteMarkdown",/);
  assert.match(preloadSource, /onPasteMarkdown:\s*\(callback\)\s*=>/);
  assert.match(editorSource, /onPasteMarkdown/);
  assert.match(editorSource, /slateMarkdownParser/);
  assert.match(editorSource, /insertContent/);
});
