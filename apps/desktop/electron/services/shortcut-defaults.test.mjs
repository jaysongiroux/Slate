import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SHORTCUTS } from "../../src/lib/shortcut-defaults.mjs";

test("default sidebar shortcut avoids the editor bold binding", () => {
  assert.equal(DEFAULT_SHORTCUTS["toggle-sidebar"], "mod+\\");
});
