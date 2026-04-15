import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();

test("desktop top bar exposes a shared persistent error indicator and calendar view publishes into it", async () => {
  const [storeSource, viewSource, topBarSource] = await Promise.all([
    readFile(path.join(appRoot, "src/stores/top-bar-error-store.ts"), "utf8"),
    readFile(path.join(appRoot, "src/components/CalendarView.tsx"), "utf8"),
    readFile(path.join(appRoot, "src/components/desktop-shell/DesktopTopBar.tsx"), "utf8"),
  ]);

  assert.match(storeSource, /export const useTopBarErrorStore = create<TopBarErrorState>/);
  assert.match(storeSource, /errors:\s*Record<string,\s*TopBarError>/);
  assert.match(storeSource, /upsertError:\s*\(error:\s*TopBarError\)\s*=>\s*void/);
  assert.match(storeSource, /clearError:\s*\(id:\s*string\)\s*=>\s*void/);
  assert.match(storeSource, /topBarErrorIndicatorPaused:\s*boolean/);

  assert.match(viewSource, /useTopBarErrorStore/);
  assert.match(viewSource, /upsertError\(/);
  assert.match(viewSource, /clearError\(/);
  assert.match(viewSource, /id:\s*"calendar-events"/);
  assert.doesNotMatch(viewSource, /calendar-toolbar-error-indicator/);

  assert.match(topBarSource, /useTopBarErrorStore/);
  assert.match(topBarSource, /AlertTriangle/);
  assert.match(topBarSource, /top-bar-error-indicator/);
  assert.match(topBarSource, /TooltipContent/);
  assert.match(topBarSource, /onMouseEnter=\{\(\) => setTopBarErrorIndicatorPaused\(true\)\}/);
  assert.match(topBarSource, /top-bar-error-indicator__icon/);
  assert.match(
    topBarSource,
    /"top-bar-error-indicator inline-flex size-7 items-center justify-center rounded-full border border-transparent bg-transparent text-danger\/80 transition-\[background-color,color,border-color\]/,
  );
  assert.match(topBarSource, /top-bar-error-indicator__icon[\s\S]*calendar-toolbar-error-nudge/);
});
