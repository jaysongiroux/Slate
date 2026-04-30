import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();

test("note conflict handler preserves local edits over delayed server echoes", async () => {
  const conflictSource = await readFile(path.join(appRoot, "src/db/conflict-handler.ts"), "utf8");

  assert.match(conflictSource, /Tombstones win over stale local edits/);
  assert.match(conflictSource, /Local live edits win over delayed live master echoes/);
  assert.match(conflictSource, /realMasterState\.isDeleted/);
  assert.match(conflictSource, /return Promise\.resolve\(realMasterState\)/);
  assert.match(conflictSource, /return Promise\.resolve\(newDocumentState\)/);
  assert.doesNotMatch(conflictSource, /masterTime/);
  assert.doesNotMatch(conflictSource, /localTime/);
  assert.doesNotMatch(conflictSource, /new Date\(realMasterState\.updatedAt\)/);
});
