import test from "node:test";
import assert from "node:assert/strict";

import {
  readStoredSidebarCollapsed,
  readStoredSidebarWidth,
  writeStoredSidebarCollapsed,
  writeStoredSidebarWidth,
} from "../../src/lib/sidebarPreferences.mjs";

function createStorage(seed = {}) {
  const entries = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
  };
}

test("sidebar preferences default width and expanded state when storage is empty", () => {
  const storage = createStorage();

  assert.equal(readStoredSidebarWidth(storage, 320, 240, 480), 320);
  assert.equal(readStoredSidebarCollapsed(storage), false);
});

test("sidebar preferences clamp width and persist collapsed state", () => {
  const storage = createStorage({
    "slate.desktop.sidebar-width": "999",
    "slate.desktop.sidebar-collapsed": "true",
  });

  assert.equal(readStoredSidebarWidth(storage, 320, 240, 480), 480);
  assert.equal(readStoredSidebarCollapsed(storage), true);

  writeStoredSidebarWidth(storage, 260);
  writeStoredSidebarCollapsed(storage, false);

  assert.equal(readStoredSidebarWidth(storage, 320, 240, 480), 260);
  assert.equal(readStoredSidebarCollapsed(storage), false);
});
