import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const desktopRoot = new URL("../../", import.meta.url);

function readDesktopFile(relativePath) {
  return readFileSync(join(desktopRoot.pathname, relativePath), "utf8");
}

test("Home Assistant extension toggle and rail mode are wired", () => {
  const extensions = readDesktopFile("src/components/settings/ExtensionsSection.tsx");
  const iconRail = readDesktopFile("src/components/IconRail.tsx");
  const appStore = readDesktopFile("src/stores/app-store.ts");
  const helpers = readDesktopFile("src/lib/app-helpers.ts");
  const desktopShell = readDesktopFile("src/components/desktop-shell/DesktopShell.tsx");
  const app = readDesktopFile("src/App.tsx");

  assert.match(extensions, /HOME_ASSISTANT_ENABLED_SETTING_KEY/);
  assert.match(extensions, /Home Assistant/);
  assert.match(extensions, /homeAssistantEnabled/);

  assert.match(iconRail, /"home-assistant"/);
  assert.match(iconRail, /showHomeAssistant/);
  assert.match(iconRail, /Home Assistant/);

  assert.match(appStore, /"home-assistant"/);
  assert.match(helpers, /value === "home-assistant"/);
  assert.match(helpers, /mode === "home-assistant"/);

  assert.match(desktopShell, /showHomeAssistant/);
  assert.match(app, /homeAssistantRailEligible/);
  assert.match(app, /HOME_ASSISTANT_ENABLED_SETTING_KEY/);
  assert.match(app, /showHomeAssistant=\{homeAssistantRailEligible\}/);
  assert.match(app, /sidebarMode === "home-assistant"/);
  assert.match(
    app,
    /setMainPanelMode\("home-assistant"\)|mainPanelModeForSidebarMode\(entry\.mode\)/,
  );
});
