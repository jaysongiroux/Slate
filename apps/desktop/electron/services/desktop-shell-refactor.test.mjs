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
  const stylesPath = path.join(root, "styles/tailwind.css");

  const [calendarSource, styleSource] = await Promise.all([
    readFile(calendarViewPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  assert.match(calendarSource, /onSelectEvent=/);
  assert.match(calendarSource, /calendar-view__event-popover/);
  assert.match(calendarSource, /selectedEvent/);
  assert.match(calendarSource, /document\.body\.style\.overflow = "hidden"/);
  assert.match(calendarSource, /bg-panel-elevated/);
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
