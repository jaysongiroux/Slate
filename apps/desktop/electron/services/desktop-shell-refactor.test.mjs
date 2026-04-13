import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd(), "src");

test("desktop shell refactor extracts chrome theme provider and shell state hook", async () => {
  const providerPath = path.join(root, "components/desktop-shell/ChromeThemeProvider.tsx");
  const hookPath = path.join(root, "hooks/useDesktopShellState.ts");
  const topBarPath = path.join(root, "components/desktop-shell/DesktopTopBar.tsx");
  const stylesPath = path.join(root, "styles/tailwind.css");

  const [providerSource, hookSource, topBarSource, styleSource] = await Promise.all([
    readFile(providerPath, "utf8"),
    readFile(hookPath, "utf8"),
    readFile(topBarPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  assert.match(providerSource, /monochrome gray/i);
  assert.match(providerSource, /violet/i);
  assert.match(providerSource, /bluer violet/i);
  assert.match(providerSource, /createContext|React\.createContext/);
  assert.match(providerSource, /transition-colors duration-300 ease-out/);

  assert.match(hookSource, /desktopShellColumns/);
  assert.match(hookSource, /mainPanelGridStyle/);
  assert.match(hookSource, /toggleSidebar/);
  assert.match(topBarSource, /Slate/);
  assert.match(topBarSource, /syncStatus\.label/);
  assert.match(styleSource, /\.sidebar-shell\s*\{[\s\S]*background:\s*var\(--chrome-bg\)/);
  assert.doesNotMatch(styleSource, /sidebar-shell::after/);
});

test("calendar view no longer renders the toolbar inside a card container", async () => {
  const calendarViewPath = path.join(root, "components/CalendarView.tsx");
  const stylesPath = path.join(root, "styles/tailwind.css");

  const [calendarSource, styleSource] = await Promise.all([
    readFile(calendarViewPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  assert.doesNotMatch(styleSource, /\.calendar-view__toolbar\s*\{[^}]*border:/);
  assert.doesNotMatch(styleSource, /\.calendar-view__toolbar\s*\{[^}]*border-radius:/);
  assert.doesNotMatch(styleSource, /\.calendar-view__toolbar\s*\{[^}]*background:/);
  assert.match(calendarSource, /calendar-view__toolbar/);
});

test("calendar view renders an anchored event inspector instead of a dialog", async () => {
  const calendarViewPath = path.join(root, "components/CalendarView.tsx");
  const popoverPath = path.join(root, "components/calendar/EventPopover.tsx");
  const stylesPath = path.join(root, "styles/tailwind.css");

  const [calendarSource, popoverSource, styleSource] = await Promise.all([
    readFile(calendarViewPath, "utf8"),
    readFile(popoverPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  assert.match(calendarSource, /onSelectEvent=/);
  assert.match(calendarSource, /EventPopover/);
  assert.match(calendarSource, /selectedEvent/);
  assert.match(calendarSource, /document\.body\.style\.overflow = "hidden"/);
  assert.match(popoverSource, /calendar-view__event-popover/);
  assert.match(popoverSource, /bg-panel-elevated/);
  assert.match(
    calendarSource,
    /selectedEvent\.resource\.calendarName \|\| selectedEvent\.resource\.source\.toUpperCase\(\)/,
  );
  assert.match(styleSource, /\.calendar-view__event-popover/);
});

test("shared desktop context menus do not append a Cancel item", async () => {
  const mainPath = path.resolve(process.cwd(), "electron/main.mjs");
  const mainSource = await readFile(mainPath, "utf8");

  assert.match(mainSource, /ipcMain\.handle\("desktop:showContextMenu"/);
  assert.doesNotMatch(mainSource, /label:\s*"Cancel"/);
});

test("desktop startup refreshes backend reachability before opening the window and skips remote sync while offline", async () => {
  const mainPath = path.resolve(process.cwd(), "electron/main.mjs");
  const mainSource = await readFile(mainPath, "utf8");

  assert.match(
    mainSource,
    /if \(metadataStore\.getSetting\("backendEndpoint", ""\)\) \{\s*await refreshStoredBackendStatus\(metadataStore\.getSetting\("backendEndpoint", ""\)\);\s*\}\s*\n\s*await createWindow\(\);/s,
  );
  assert.match(
    mainSource,
    /if \(\s*metadataStore\.getSetting\("authStatus", "signed_out"\) === "authenticated"\s*&&\s*metadataStore\.getSetting\("backendReachable", false\)\s*\) \{\s*void syncNotesFromServer\(\);\s*\}/s,
  );
});

test("calendar IPC gracefully falls back when the backend connection is refused", async () => {
  const mainPath = path.resolve(process.cwd(), "electron/main.mjs");
  const mainSource = await readFile(mainPath, "utf8");

  assert.match(mainSource, /isBackendConnectionError/);
  assert.match(
    mainSource,
    /if \(isBackendConnectionError\(error\)\) \{[\s\S]*return fallbackValue;[\s\S]*\}/,
  );
});
