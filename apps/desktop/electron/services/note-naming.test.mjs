import test from "node:test";
import assert from "node:assert/strict";

test("validatePathSegmentName allows spaces but rejects blank names", async () => {
  const { validatePathSegmentName } = await import("../../src/lib/note-naming.mjs");

  assert.equal(validatePathSegmentName("My Design Doc"), null);
  assert.equal(validatePathSegmentName("   "), "Name is required.");
});

test("displayNameFromPath returns a human-friendly file name from the path", async () => {
  const { displayNameFromPath } = await import("../../src/lib/note-naming.mjs");

  assert.equal(displayNameFromPath("personal/projects/slate/slate-todo"), "slate todo");
});
