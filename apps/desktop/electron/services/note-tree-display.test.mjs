import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const appRoot = process.cwd();

let noteTreeModulePromise;

async function loadNoteTreeModule() {
  if (!noteTreeModulePromise) {
    noteTreeModulePromise = (async () => {
      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "slate-note-tree-"));
      const outfile = path.join(tmpDir, "noteTree.mjs");
      await build({
        entryPoints: [path.join(appRoot, "src/lib/noteTree.ts")],
        outfile,
        bundle: true,
        format: "esm",
        platform: "node",
        logLevel: "silent",
      });
      return import(pathToFileURL(outfile).href);
    })();
  }
  return noteTreeModulePromise;
}

test("left note tree renders stored note titles instead of path-derived basenames", async () => {
  const source = await readFile(path.join(appRoot, "src/components/NoteTree.tsx"), "utf8");

  assert.doesNotMatch(source, /title=\{basename\(note\.path\)\}/);
  assert.doesNotMatch(source, /\{basename\(note\.path\)\}/);
  assert.match(source, /title=\{note\.title\}/);
  assert.match(source, /\{note\.title\}/);
});

test("buildNoteTree sorts notes by stored title instead of normalized file basename", async () => {
  const { buildNoteTree } = await loadNoteTreeModule();

  const tree = buildNoteTree([
    {
      id: "b",
      title: "Beta",
      path: "a-file-name.md",
      isDeleted: false,
      isTemplate: false,
      pinned: false,
      updatedAt: "2026-04-21T00:00:00.000Z",
    },
    {
      id: "a",
      title: "Alpha",
      path: "z-file-name.md",
      isDeleted: false,
      isTemplate: false,
      pinned: false,
      updatedAt: "2026-04-21T00:00:00.000Z",
    },
  ]);

  assert.deepEqual(
    tree[0].notes.map((note) => note.id),
    ["a", "b"],
  );
});
