import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();

test("desktop API exposes persisted rail tab and calendar filter settings", async () => {
  const [mainSource, preloadSource, apiSource] = await Promise.all([
    readFile(path.join(appRoot, "electron/main.mjs"), "utf8"),
    readFile(path.join(appRoot, "electron/preload.mjs"), "utf8"),
    readFile(path.join(appRoot, "src/lib/api.ts"), "utf8"),
  ]);

  assert.match(mainSource, /desktop:getLastSidebarMode/);
  assert.match(mainSource, /desktop:setLastSidebarMode/);
  assert.match(mainSource, /desktop:getCalendarVisibilityFilters/);
  assert.match(mainSource, /desktop:setCalendarVisibilityFilters/);

  assert.match(
    preloadSource,
    /getLastSidebarMode:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("desktop:getLastSidebarMode"\)/,
  );
  assert.match(
    preloadSource,
    /setLastSidebarMode:\s*\(mode\)\s*=>\s*ipcRenderer\.invoke\("desktop:setLastSidebarMode", mode\)/,
  );
  assert.match(
    preloadSource,
    /getCalendarVisibilityFilters:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("desktop:getCalendarVisibilityFilters"\)/,
  );
  assert.match(
    preloadSource,
    /setCalendarVisibilityFilters:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\("desktop:setCalendarVisibilityFilters", payload\)/,
  );

  assert.match(apiSource, /getLastSidebarMode\(\): Promise<SidebarMode \| null>/);
  assert.match(apiSource, /setLastSidebarMode\(mode: SidebarMode\): Promise<void>/);
  assert.match(
    apiSource,
    /getCalendarVisibilityFilters\(\): Promise<CalendarVisibilityFilters \| null>/,
  );
  assert.match(
    apiSource,
    /setCalendarVisibilityFilters\(payload: CalendarVisibilityFilters\): Promise<void>/,
  );
});

test("app restores rail tab and reconciles persisted calendar visibility filters", async () => {
  const appSource = await readFile(path.join(appRoot, "src/App.tsx"), "utf8");

  assert.match(appSource, /getLastSidebarMode\(\)/);
  assert.match(appSource, /setLastSidebarMode\((mode|sidebarMode)\)/);
  assert.match(appSource, /getCalendarVisibilityFilters\(\)/);
  assert.match(appSource, /setCalendarVisibilityFilters\(/);
  assert.match(appSource, /selectedCalendarIds/);
  assert.match(appSource, /selectedIcsIds/);
  assert.match(appSource, /reconcileCalendarVisibilityFilters/);
});

test("calendar UI supports visibility filters and disabled create affordance", async () => {
  const [sidebarSource, viewSource, appSource] = await Promise.all([
    readFile(path.join(appRoot, "src/components/CalendarSidebar.tsx"), "utf8"),
    readFile(path.join(appRoot, "src/components/CalendarView.tsx"), "utf8"),
    readFile(path.join(appRoot, "src/App.tsx"), "utf8"),
  ]);

  assert.match(sidebarSource, /selectedCalendarIds/);
  assert.match(sidebarSource, /selectedIcsIds/);
  assert.match(sidebarSource, /onToggleCalendarVisibility/);
  assert.match(sidebarSource, /onToggleIcsVisibility/);
  assert.match(sidebarSource, /type="checkbox"/);

  assert.match(viewSource, /canCreateEvent/);
  assert.match(viewSource, /createEventDisabledReason/);
  assert.match(viewSource, /selectedProviderCalendarIds/);
  assert.match(viewSource, /calendarNameBySourceId/);
  assert.match(viewSource, /selectedEventCalendarName/);
  assert.match(viewSource, /disabled=\{!canCreateEvent\}/);
  assert.match(viewSource, /selectedProviderCalendars\.has\(event\.calendarId\)/);
  assert.match(appSource, /calendarNameBySourceId/);
  assert.match(appSource, /Enable or connect a writable calendar to create events\./);
});
