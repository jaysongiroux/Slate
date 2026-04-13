import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();

test("desktop API exposes persisted rail tab and calendar filter settings", async () => {
  const [mainSource, preloadSource, apiSource] = await Promise.all([
    readFile(path.join(appRoot, "electron/main.mjs"), "utf8"),
    readFile(path.join(appRoot, "electron/preload.mjs"), "utf8"),
    readFile(path.join(appRoot, "src/lib/api/ipc-core.ts"), "utf8"),
  ]);

  assert.match(mainSource, /desktop:getLastSidebarMode/);
  assert.match(mainSource, /desktop:setLastSidebarMode/);
  assert.match(mainSource, /desktop:getCalendarVisibilityFilters/);
  assert.match(mainSource, /desktop:setCalendarVisibilityFilters/);
  assert.match(mainSource, /desktop:getCalendarReminderSettings/);
  assert.match(mainSource, /desktop:setCalendarReminderSettings/);

  assert.match(
    preloadSource,
    /getLastSidebarMode:\s*\(\)\s*=>\s*invoke\("desktop:getLastSidebarMode"\)/,
  );
  assert.match(
    preloadSource,
    /setLastSidebarMode:\s*\(mode\)\s*=>\s*invoke\("desktop:setLastSidebarMode", mode\)/,
  );
  assert.match(
    preloadSource,
    /getCalendarVisibilityFilters:\s*\(\)\s*=>\s*invoke\("desktop:getCalendarVisibilityFilters"\)/,
  );
  assert.match(
    preloadSource,
    /setCalendarVisibilityFilters:\s*\(payload\)\s*=>\s*invoke\("desktop:setCalendarVisibilityFilters", payload\)/,
  );
  assert.match(
    preloadSource,
    /getCalendarReminderSettings:\s*\(\)\s*=>\s*invoke\("desktop:getCalendarReminderSettings"\)/,
  );
  assert.match(
    preloadSource,
    /setCalendarReminderSettings:\s*\(payload\)\s*=>\s*invoke\("desktop:setCalendarReminderSettings", payload\)/,
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
  assert.match(apiSource, /getCalendarReminderSettings\(\): Promise<CalendarReminderSettings>/);
  assert.match(
    apiSource,
    /setCalendarReminderSettings\(payload: CalendarReminderSettings\): Promise<void>/,
  );
});

test("app restores rail tab and reconciles persisted calendar visibility filters", async () => {
  const [backendActionsSource, calendarStateSource, appSource] = await Promise.all([
    readFile(path.join(appRoot, "src/hooks/useBackendActions.ts"), "utf8"),
    readFile(path.join(appRoot, "src/hooks/useCalendarState.ts"), "utf8"),
    readFile(path.join(appRoot, "src/App.tsx"), "utf8"),
  ]);

  assert.match(backendActionsSource, /getLastSidebarMode\(\)/);
  assert.match(backendActionsSource, /setLastSidebarMode\(/);
  assert.match(backendActionsSource, /getCalendarVisibilityFilters\(\)/);
  assert.match(backendActionsSource, /setCalendarVisibilityFilters/);
  assert.match(backendActionsSource, /getCalendarReminderSettings\(\)/);
  assert.match(backendActionsSource, /setCalendarReminderSettings/);
  assert.match(appSource, /selectedCalendarIds/);
  assert.match(appSource, /selectedIcsIds/);
  assert.match(
    calendarStateSource,
    /reconcileCalendarVisibilityFilters|setCalendarVisibilityFilters/,
  );
});

test("calendar UI supports visibility filters, disabled create affordance, and reminder settings", async () => {
  const [sidebarSource, listItemSource, viewSource, appSource, calendarSectionSource] =
    await Promise.all([
      readFile(path.join(appRoot, "src/components/CalendarSidebar.tsx"), "utf8"),
      readFile(path.join(appRoot, "src/components/calendar/CalendarListItem.tsx"), "utf8"),
      readFile(path.join(appRoot, "src/components/CalendarView.tsx"), "utf8"),
      readFile(path.join(appRoot, "src/App.tsx"), "utf8"),
      readFile(path.join(appRoot, "src/components/settings/CalendarSection.tsx"), "utf8"),
    ]);

  assert.match(sidebarSource, /selectedCalendarIds/);
  assert.match(sidebarSource, /selectedIcsIds/);
  assert.match(sidebarSource, /onToggleCalendarVisibility/);
  assert.match(sidebarSource, /onToggleIcsVisibility/);
  assert.match(listItemSource, /type="checkbox"/);

  assert.match(viewSource, /canCreateEvent/);
  assert.match(viewSource, /createEventDisabledReason/);
  assert.match(viewSource, /selectedProviderCalendarIds/);
  assert.match(viewSource, /calendarNameBySourceId/);
  assert.match(viewSource, /selectedEventCalendarName/);
  assert.match(viewSource, /disabled=\{!canCreateEvent\}/);
  assert.match(appSource, /calendarNameBySourceId/);
  assert.match(calendarSectionSource, /Remind me before events/);
  assert.match(calendarSectionSource, /Minutes before start/);
  assert.match(calendarSectionSource, /Play sound/);
});
