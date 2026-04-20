import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const desktopRoot = new URL("../../", import.meta.url);

function readDesktopFile(relativePath) {
  return readFileSync(join(desktopRoot.pathname, relativePath), "utf8");
}

test("settings dialog gives nav and panel independent hidden-scroll regions", () => {
  const settingsDialog = readDesktopFile("src/components/SettingsDialog.tsx");

  assert.match(settingsDialog, /bodyClassName=/);
  assert.match(settingsDialog, /overflow-hidden/);

  assert.match(settingsDialog, /aria-label="Settings categories"[\s\S]*overflow-y-auto/);
  assert.match(settingsDialog, /aria-label="Settings categories"[\s\S]*\[scrollbar-width:none\]/);
  assert.match(
    settingsDialog,
    /aria-label="Settings categories"[\s\S]*\[&::\-webkit-scrollbar\]:hidden/,
  );

  assert.match(settingsDialog, /role="tabpanel"[\s\S]*min-h-0/);
  assert.match(settingsDialog, /role="tabpanel"[\s\S]*overflow-hidden/);
  assert.match(settingsDialog, /overflow-y-auto overflow-x-hidden/);
  assert.match(settingsDialog, /overflow-y-auto overflow-x-hidden[\s\S]*\[scrollbar-width:none\]/);
  assert.match(
    settingsDialog,
    /overflow-y-auto overflow-x-hidden[\s\S]*\[&::\-webkit-scrollbar\]:hidden/,
  );
});
