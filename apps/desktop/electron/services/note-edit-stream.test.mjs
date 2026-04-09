import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();

test("AI note edits bridge streamed content from chat events into the open editor", async () => {
  const [chatSidebarSource, editorSource, appSource] = await Promise.all([
    readFile(path.join(appRoot, "src/components/ChatSidebar.tsx"), "utf8"),
    readFile(path.join(appRoot, "src/components/NovelEditor.tsx"), "utf8"),
    readFile(path.join(appRoot, "src/App.tsx"), "utf8"),
  ]);

  assert.match(chatSidebarSource, /slate-ai-note-stream/);
  assert.match(chatSidebarSource, /window\.dispatchEvent/);
  assert.match(editorSource, /AI_NOTE_STREAM_EVENT\s*=\s*"slate-ai-note-stream"/);
  assert.match(editorSource, /window\.addEventListener\(AI_NOTE_STREAM_EVENT/);
  assert.match(editorSource, /setContent\(/);
  assert.match(appSource, /noteId=\{selectedNoteId\}/);
});
