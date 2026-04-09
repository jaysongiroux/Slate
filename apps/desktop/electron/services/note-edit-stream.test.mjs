import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();

test("AI note edits keep the current note stable until the final content is ready", async () => {
  const [chatSidebarSource, editorSource, appSource] = await Promise.all([
    readFile(path.join(appRoot, "src/components/ChatSidebar.tsx"), "utf8"),
    readFile(path.join(appRoot, "src/components/NovelEditor.tsx"), "utf8"),
    readFile(path.join(appRoot, "src/App.tsx"), "utf8"),
  ]);

  assert.match(chatSidebarSource, /slate-ai-note-stream/);
  assert.match(chatSidebarSource, /window\.dispatchEvent/);
  assert.match(chatSidebarSource, /phase:\s*"start"/);
  assert.match(chatSidebarSource, /phase:\s*"done"/);
  assert.match(editorSource, /AI_NOTE_STREAM_EVENT\s*=\s*"slate-ai-note-stream"/);
  assert.match(editorSource, /window\.addEventListener\(AI_NOTE_STREAM_EVENT/);
  assert.match(editorSource, /stream\.kind === "edit" && detail\.phase !== "done"/);
  assert.doesNotMatch(editorSource, /mergeStreamingEditPreview/);
  assert.match(editorSource, /setContent\(/);
  assert.match(appSource, /noteId=\{selectedNoteId\}/);
});
