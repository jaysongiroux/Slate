import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const desktopRoot = new URL("../../", import.meta.url);

function readDesktopFile(relativePath) {
  return readFileSync(join(desktopRoot.pathname, relativePath), "utf8");
}

test("Home Assistant panel renders dashboards, browse views, and safe controls", () => {
  const panel = readDesktopFile("src/components/home-assistant/HomeAssistantPanel.tsx");
  const dashboard = readDesktopFile("src/components/home-assistant/HomeAssistantDashboardView.tsx");
  const browse = readDesktopFile("src/components/home-assistant/HomeAssistantBrowseView.tsx");
  const sidebar = readDesktopFile("src/components/home-assistant/HomeAssistantSidebar.tsx");
  const card = readDesktopFile("src/components/home-assistant/HomeAssistantEntityCard.tsx");
  const bento = readDesktopFile("src/components/home-assistant/home-assistant-bento.ts");
  const entitySections = readDesktopFile(
    "src/components/home-assistant/home-assistant-entity-sections.tsx",
  );
  const errors = readDesktopFile("src/components/home-assistant/home-assistant-errors.ts");
  const app = readDesktopFile("src/App.tsx");

  assert.match(panel, /selectedInstanceId/);
  assert.match(panel, /selectedDashboardId/);
  assert.match(panel, /selectedBrowseMode/);
  assert.match(panel, /HomeAssistantDashboardView/);
  assert.match(panel, /HomeAssistantBrowseView/);
  assert.match(panel, /min-w-0/);
  assert.match(panel, /overflow-hidden/);

  assert.match(dashboard, /getHomeAssistantDashboard/);
  assert.match(dashboard, /stale/);
  assert.match(dashboard, /formatHomeAssistantUiError/);
  assert.match(dashboard, /home-assistant-entity-sections/);
  assert.match(dashboard, /HomeAssistantControllableEntitiesSection/);
  assert.match(dashboard, /HomeAssistantReadOnlyEntitiesSection/);
  assert.match(dashboard, /controllableDashboardEntities/);
  assert.match(dashboard, /readOnlyDashboardEntities/);
  assert.match(dashboard, /min-w-0/);
  assert.match(dashboard, /overflow-hidden/);
  assert.match(dashboard, /overflow-y-auto/);
  assert.match(dashboard, /\[scrollbar-width:none\]/);
  assert.match(dashboard, /\[&::-webkit-scrollbar\]:hidden/);

  assert.match(browse, /getHomeAssistantAreas/);
  assert.match(browse, /home-assistant-entity-sections/);
  assert.match(browse, /getHomeAssistantDevices/);
  assert.match(browse, /getHomeAssistantEntities/);
  assert.match(browse, /subscribeHomeAssistantEvents/);
  assert.match(browse, /patchEntityState/);
  assert.match(browse, /liveStatus/);
  assert.match(browse, /Live/);
  assert.match(browse, /searchQuery/);
  assert.match(browse, /filteredAreas/);
  assert.match(browse, /filteredDevices/);
  assert.match(browse, /filteredEntities/);
  assert.match(browse, /Search \$\{mode\}/);
  assert.match(browse, /matches/);
  assert.match(browse, /selectedDeviceId/);
  assert.match(browse, /selectedAreaId/);
  assert.match(browse, /areaDevices/);
  assert.match(browse, /deviceEntities/);
  assert.match(browse, /controllableDeviceEntities/);
  assert.match(browse, /readOnlyDeviceEntities/);
  assert.match(browse, /controllableFilteredEntities/);
  assert.match(browse, /readOnlyFilteredEntities/);
  assert.match(browse, /HomeAssistantReadOnlyEntitiesSection/);
  assert.match(browse, /HomeAssistantControllableEntitiesSection/);
  assert.match(browse, /supportedControls\.length > 0/);
  assert.match(browse, /supportedControls\.length === 0/);
  assert.match(entitySections, /Read-only/);
  assert.match(entitySections, /\n\s*Controls\n/);
  assert.match(entitySections, /aria-label="Read-only list view"/);
  assert.doesNotMatch(browse, /Back to devices/);
  assert.doesNotMatch(browse, /ChevronLeft/);
  assert.match(browse, /useNavigationStore/);
  assert.match(browse, /type: "homeAssistant"/);
  assert.match(browse, /areaId: area\.id/);
  assert.match(browse, /filter\(\(device\) => device\.areaId === selectedArea\.id\)/);
  assert.match(browse, /filter\(\(entity\) => entity\.deviceId === selectedDevice\.id\)/);
  assert.match(browse, /className="relative mt-3 w-full"/);
  assert.match(browse, /No entities found for this device/);
  assert.match(browse, /No devices found for this area/);
  assert.match(browse, /min-w-0/);
  assert.match(browse, /overflow-hidden/);
  assert.match(browse, /overflow-y-auto/);
  assert.match(browse, /\[scrollbar-width:none\]/);
  assert.match(browse, /\[&::-webkit-scrollbar\]:hidden/);
  assert.doesNotMatch(browse, /overflow-auto/);
  assert.match(sidebar, /useNavigationStore/);
  assert.doesNotMatch(sidebar, /ScrollArea/);
  assert.doesNotMatch(sidebar, /ui-scroll-area/);
  assert.match(app, /entry\.type === "homeAssistant"/);

  assert.match(card, /supportedControls/);
  assert.match(card, /formatHomeAssistantCardValue/);
  assert.match(card, /Intl\.DateTimeFormat/);
  assert.match(card, /month:\s*"short"/);
  assert.match(card, /variant="ghost"/);
  assert.match(card, /text-\[0\.8rem\]/);
  assert.match(card, /article className="min-w-0/);
  assert.match(card, /truncate text-\[0\.72rem\] text-faint/);
  assert.match(card, /canControl/);
  assert.match(card, /isCamera/);
  assert.match(card, /resolveHomeAssistantCameraSnapshotUrl/);
  assert.match(card, /Camera snapshot/);
  assert.match(card, /Camera preview unavailable/);
  assert.match(card, /controlHomeAssistantEntity/);
  assert.match(card, /onChanged\?\.\(result\.state/);
  assert.match(card, /light_brightness/);
  assert.match(card, /light_color/);
  assert.match(card, /climate_temperature/);
  assert.match(card, /scene_run|script_run/);

  assert.match(entitySections, /getHomeAssistantEntityBentoClass/);
  assert.match(entitySections, /homeAssistantEntityMasonryContainerClass/);
  assert.match(entitySections, /entity\.domain === "camera"/);
  assert.match(bento, /getHomeAssistantEntityBentoClass/);
  assert.match(bento, /entity\.domain === "camera"/);
  assert.match(bento, /entity\.domain === "climate"/);
  assert.match(bento, /supportedControls\.includes\("light_brightness"\)/);
  assert.match(bento, /sm:\[grid-column:span_2\]/);
  assert.match(bento, /break-inside-avoid/);
  assert.match(bento, /columns-2/);
  assert.match(bento, /xl:columns-4/);

  assert.match(errors, /Home Assistant action failed/);
  assert.match(app, /HomeAssistantPanel/);
});
