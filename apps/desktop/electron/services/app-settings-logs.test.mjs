import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const desktopRoot = new URL("../../", import.meta.url);

function readDesktopFile(relativePath) {
  return readFileSync(join(desktopRoot.pathname, relativePath), "utf8");
}

test("settings dialog exposes App settings with a streamed Logs panel", () => {
  const settingsDialog = readDesktopFile("src/components/SettingsDialog.tsx");
  const appSettingsSection = readDesktopFile("src/components/settings/AppSettingsSection.tsx");
  const preload = readDesktopFile("electron/preload.mjs");
  const main = readDesktopFile("electron/main.mjs");
  const ipcCore = readDesktopFile("src/lib/api/ipc-core.ts");

  assert.match(settingsDialog, /"app-settings"/);
  assert.match(settingsDialog, /App settings/);
  assert.match(settingsDialog, /AppSettingsSection/);

  assert.match(appSettingsSection, /Logs/);
  assert.match(appSettingsSection, /subscribeAppLog/);
  assert.doesNotMatch(appSettingsSection, /setInterval|Refresh/);
  assert.doesNotMatch(appSettingsSection, /statusText|Streaming|Connecting/);
  assert.match(appSettingsSection, /details\?: string/);
  assert.match(appSettingsSection, /line\.details/);

  assert.match(preload, /subscribeAppLog:/);
  assert.match(preload, /desktop:subscribeAppLog/);
  assert.match(preload, /desktop:appLogEvent/);
  assert.match(preload, /desktop:unsubscribeAppLog/);

  assert.match(main, /ipcMain\.handle\("desktop:subscribeAppLog"/);
  assert.match(main, /createDesktopLogStream/);
  assert.match(ipcCore, /subscribeAppLog\(/);
});
