import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const desktopRoot = new URL("../../", import.meta.url);

function readDesktopFile(relativePath) {
  return readFileSync(join(desktopRoot.pathname, relativePath), "utf8");
}

test("Home Assistant store and add-instance dialog are wired", () => {
  const store = readDesktopFile("src/stores/home-assistant-store.ts");
  const uiStore = readDesktopFile("src/stores/ui-store.ts");
  const dialog = readDesktopFile(
    "src/components/home-assistant/AddHomeAssistantInstanceDialog.tsx",
  );
  const app = readDesktopFile("src/App.tsx");

  assert.match(store, /selectedInstanceId:\s*null/);
  assert.match(store, /selectedDashboardId:\s*null/);
  assert.match(store, /selectedBrowseMode:\s*"dashboards"/);
  assert.match(store, /refreshSignal:\s*0/);
  assert.match(store, /resetNavigation/);

  assert.match(uiStore, /addHomeAssistantInstanceOpen/);
  assert.match(uiStore, /setAddHomeAssistantInstanceOpen/);

  assert.match(dialog, /addHomeAssistantInstance/);
  assert.match(dialog, /formatHomeAssistantUiError/);
  assert.match(dialog, /url:\s*url\.trim\(\)/);
  assert.match(dialog, /token:\s*token\.trim\(\)/);
  assert.match(dialog, /name:\s*name\.trim\(\) \|\| undefined/);
  assert.match(dialog, /Long-lived access token/);

  assert.match(app, /AddHomeAssistantInstanceDialog/);
  assert.match(app, /addHomeAssistantInstanceOpen/);
  assert.match(app, /setHomeAssistantRefreshSignal/);
});
