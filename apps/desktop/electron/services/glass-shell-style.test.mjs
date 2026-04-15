import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.resolve(__dirname, "../../src/styles/tailwind.css");
const css = fs.readFileSync(cssPath, "utf8");
const checklistViewSource = fs.readFileSync(
  path.resolve(__dirname, "../../src/components/ChecklistView.tsx"),
  "utf8",
);
const checklistsSidebarSource = fs.readFileSync(
  path.resolve(__dirname, "../../src/components/ChecklistsSidebar.tsx"),
  "utf8",
);

test("desktop shell stays transparent so glass sidebars can reveal apps behind the window", () => {
  assert.match(css, /\.desktop-shell\s*\{[\s\S]*background:\s*transparent;/);
  assert.doesNotMatch(css, /\.desktop-shell\s*\{[\s\S]*background:\s*var\(--panel-bg\)/);
});

test("left panel and note editor scroll areas never show scrollbars", () => {
  assert.match(css, /\.sidebar-shell,\s*\.sidebar-shell \*\s*\{[\s\S]*scrollbar-width:\s*none;/);
  assert.match(css, /\.sidebar-shell,\s*\.sidebar-shell \*\s*\{[\s\S]*-ms-overflow-style:\s*none;/);
  assert.match(
    css,
    /\.sidebar-shell::\-webkit-scrollbar,\s*\.sidebar-shell \*::\-webkit-scrollbar\s*\{[\s\S]*display:\s*none;/,
  );
  assert.match(css, /\.sidebar-shell \.ui-scroll-area__scrollbar\s*\{[\s\S]*display:\s*none;/);

  assert.match(
    css,
    /\.note-scroll-area,\s*\.note-scroll-area \*\s*\{[\s\S]*scrollbar-width:\s*none;/,
  );
  assert.match(
    css,
    /\.note-scroll-area,\s*\.note-scroll-area \*\s*\{[\s\S]*-ms-overflow-style:\s*none;/,
  );
  assert.match(
    css,
    /\.note-scroll-area::\-webkit-scrollbar,\s*\.note-scroll-area \*::\-webkit-scrollbar\s*\{[\s\S]*display:\s*none;/,
  );
  assert.match(css, /\.note-scroll-area \.ui-scroll-area__scrollbar\s*\{[\s\S]*display:\s*none;/);
});

test("task list tab uses hidden-scroll panel containers on both sides", () => {
  assert.match(checklistsSidebarSource, /note-scroll-area/);
  assert.match(checklistViewSource, /note-scroll-area/);
  assert.match(checklistViewSource, /ui-scroll-area__scrollbar--vertical/);
});

test("dialog surface does not show a blue focus border when active", () => {
  assert.match(
    css,
    /\.slate-dialog-content-surface:focus,\s*\.slate-dialog-content-surface:focus-visible\s*\{[\s\S]*outline:\s*none;/,
  );
  assert.match(
    css,
    /\.slate-dialog-content-surface:focus,\s*\.slate-dialog-content-surface:focus-visible\s*\{[\s\S]*border-color:\s*var\(--dialog-surface-border\);/,
  );
});
