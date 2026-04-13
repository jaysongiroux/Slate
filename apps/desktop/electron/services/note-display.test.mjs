import test from "node:test";
import assert from "node:assert/strict";
import { displayNoteTitle } from "../../src/lib/note-display.mjs";

test("displayNoteTitle: prefers the path basename when the stored title is generic", () => {
  assert.equal(
    displayNoteTitle({ title: "Untitled", path: "projects/launch-plan" }),
    "launch-plan",
  );
});

test("displayNoteTitle: keeps a meaningful stored title", () => {
  assert.equal(
    displayNoteTitle({ title: "Launch Plan", path: "projects/launch-plan" }),
    "Launch Plan",
  );
});
