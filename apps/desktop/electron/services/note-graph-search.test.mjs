import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchNoteGraphTitles } from "../../src/lib/note-graph-search.mjs";

const appRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");

test("searchNoteGraphTitles ranks exact and prefix title matches before contains matches", () => {
  const nodes = [
    { id: "contains", title: "Project plan notes" },
    { id: "exact", title: "Plan" },
    { id: "prefix", title: "Planning index" },
    { id: "miss", title: "Archive" },
  ];

  assert.deepEqual(
    searchNoteGraphTitles(nodes, " plan ").map((node) => node.id),
    ["exact", "prefix", "contains"],
  );
});

test("searchNoteGraphTitles is case-insensitive and returns no matches for blank queries", () => {
  const nodes = [
    { id: "daily", title: "Daily Review" },
    { id: "weekly", title: "Weekly Review" },
  ];

  assert.deepEqual(
    searchNoteGraphTitles(nodes, "review").map((node) => node.id),
    ["daily", "weekly"],
  );
  assert.deepEqual(searchNoteGraphTitles(nodes, "   "), []);
});

test("NoteGraphView wires title search into matched node highlighting", async () => {
  const source = await readFile(path.join(appRoot, "src/components/NoteGraphView.tsx"), "utf8");

  assert.match(source, /searchNoteGraphTitles/);
  assert.match(source, /placeholder="Search titles/);
  assert.match(source, /activeSearchId/);
  assert.match(source, /note-graph-search-glow/);
});

test("NoteGraphView animates the camera when search navigation changes nodes", async () => {
  const source = await readFile(path.join(appRoot, "src/components/NoteGraphView.tsx"), "utf8");

  assert.match(source, /animateSearchPanTo/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /SEARCH_CAMERA_ANIMATION_MS/);
});

test("Mod+F focuses the graph title search when the note graph is open", async () => {
  const [appSource, graphSource, shortcutsSource] = await Promise.all([
    readFile(path.join(appRoot, "src/App.tsx"), "utf8"),
    readFile(path.join(appRoot, "src/components/NoteGraphView.tsx"), "utf8"),
    readFile(path.join(appRoot, "src/hooks/useAppKeyboardShortcuts.ts"), "utf8"),
  ]);

  assert.match(appSource, /graphSearchInputRef\s*=\s*useRef<HTMLInputElement \| null>\(null\)/);
  assert.match(appSource, /graphSearchInputRef=\{graphSearchInputRef\}/);
  assert.match(graphSource, /graphSearchInputRef\?: RefObject<HTMLInputElement \| null>/);
  assert.match(graphSource, /ref=\{graphSearchInputRef\}/);
  assert.match(shortcutsSource, /mainPanelMode === "graph"/);
  assert.match(shortcutsSource, /graphSearchInputRef\.current\?\.focus\(\)/);
});
