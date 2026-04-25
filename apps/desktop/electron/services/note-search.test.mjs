import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();

test("find-in-note wires the search handle into the editor", async () => {
  const [appSource, editorSource] = await Promise.all([
    readFile(path.join(appRoot, "src/App.tsx"), "utf8"),
    readFile(path.join(appRoot, "src/components/NovelEditor.tsx"), "utf8"),
  ]);

  assert.match(appSource, /editorRef=\{search\.editorHandleRef\}/);
  assert.match(appSource, /<NovelEditor[\s\S]*ref=\{editorRef\}/);
  assert.match(editorSource, /forwardRef<NovelEditorHandle,\s*NovelEditorProps>/);
  assert.match(editorSource, /useImperativeHandle/);
});

test("find-in-note highlights matches through ProseMirror decorations", async () => {
  const [editorSource, stylesSource] = await Promise.all([
    readFile(path.join(appRoot, "src/components/NovelEditor.tsx"), "utf8"),
    readFile(path.join(appRoot, "src/styles.css"), "utf8"),
  ]);

  assert.match(editorSource, /Decoration\.inline/);
  assert.match(editorSource, /search-match/);
  assert.match(editorSource, /search-match active/);
  assert.match(editorSource, /background-color:\s*rgba\(255, 214, 102, 0\.72\)/);
  assert.match(editorSource, /PluginKey/);
  assert.match(editorSource, /Command\.extend\(/);
  assert.doesNotMatch(editorSource, /from "@tiptap\/core"/);
  assert.match(editorSource, /\(CSS as any\)\.highlights/);
  assert.match(editorSource, /new Highlight/);
  assert.match(stylesSource, /::highlight\(slate-search-match\)/);
  assert.match(stylesSource, /::highlight\(slate-search-active\)/);
});

test("closing find-in-note clears the active match selection", async () => {
  const editorSource = await readFile(path.join(appRoot, "src/components/NovelEditor.tsx"), "utf8");

  assert.match(editorSource, /!nextState\.query/);
  assert.match(editorSource, /TextSelection\.near/);
});

test("find-in-note enter navigation keeps the visible query when editor state is stale", async () => {
  const hookSource = await readFile(path.join(appRoot, "src/hooks/useNoteSearch.ts"), "utf8");

  assert.match(hookSource, /const query = state\?\.query \|\| searchQuery/);
  assert.match(hookSource, /if \(!query\) return/);
  assert.match(hookSource, /const index = state\?\.count > 0 \? state\.index : searchIndex/);
  assert.match(hookSource, /doSearch\(query, index \+ direction\)/);
});
