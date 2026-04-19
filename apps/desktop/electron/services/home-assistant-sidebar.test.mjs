import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const desktopRoot = new URL("../../", import.meta.url);

function readDesktopFile(relativePath) {
  return readFileSync(join(desktopRoot.pathname, relativePath), "utf8");
}

test("Home Assistant sidebar lists instances, dashboards, and browse modes", () => {
  const sidebar = readDesktopFile("src/components/home-assistant/HomeAssistantSidebar.tsx");
  const app = readDesktopFile("src/App.tsx");

  assert.match(sidebar, /backendReachable/);
  assert.match(sidebar, /backendAuthenticated/);
  assert.match(sidebar, /getHomeAssistantInstances/);
  assert.match(sidebar, /getHomeAssistantDashboards/);
  assert.match(sidebar, /setAddHomeAssistantInstanceOpen/);
  assert.match(sidebar, /setSelectedInstanceId/);
  assert.match(sidebar, /setSelectedDashboardId/);
  assert.match(sidebar, /setSelectedBrowseMode\("areas"\)/);
  assert.match(sidebar, /setSelectedBrowseMode\("devices"\)/);
  assert.match(sidebar, /setSelectedBrowseMode\("entities"\)/);
  assert.match(sidebar, /setSelectedBrowseMode\("scenes"\)/);
  assert.match(sidebar, />Scenes</);
  assert.match(sidebar, /Dashboards/);
  assert.match(sidebar, /Browse/);
  assert.match(sidebar, /Add a Home Assistant instance/);

  assert.match(app, /HomeAssistantSidebar/);
  assert.match(app, /refreshSignal=\{homeAssistantRefreshSignal\}/);
});
