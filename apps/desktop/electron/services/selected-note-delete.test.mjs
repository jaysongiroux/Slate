import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();

test("app clears selection when selected RxDB note is deleted or filtered out", async () => {
  const appSource = await readFile(path.join(appRoot, "src/App.tsx"), "utf8");

  assert.match(appSource, /selected note was deleted remotely/);
  assert.match(appSource, /selectedNoteId/);
  assert.match(appSource, /rxNotes\.some\(\(note\) => note\.id === selectedNoteId\)/);
  assert.match(appSource, /setSelectedNote\(null\)/);
  assert.match(appSource, /setSelectedNoteId\(""\)/);
});
