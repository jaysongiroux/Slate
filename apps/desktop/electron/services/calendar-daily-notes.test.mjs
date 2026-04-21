import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const appRoot = process.cwd();

let modulePromise;

async function loadCalendarDailyNotes() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "slate-calendar-daily-notes-"));
      const outfile = path.join(tmpDir, "calendar-daily-notes.mjs");
      await build({
        entryPoints: [path.join(appRoot, "src/lib/calendar-daily-notes.ts")],
        outfile,
        bundle: true,
        format: "esm",
        platform: "node",
        logLevel: "silent",
      });
      return import(pathToFileURL(outfile).href);
    })();
  }
  return modulePromise;
}

test("daily note arrow titles render as one inclusive multi-day all-day event", async () => {
  const { dailyNoteSummariesToCalendarEvents } = await loadCalendarDailyNotes();

  const events = dailyNoteSummariesToCalendarEvents(
    [{ id: "note-1", title: "2026-04-21 -> 2026-04-23" }],
    new Date("2026-04-01T00:00:00"),
    new Date("2026-04-30T23:59:59"),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "note-1:2026-04-21:2026-04-23");
  assert.equal(events[0].startTime, "2026-04-21");
  assert.equal(events[0].endTime, "2026-04-24");
  assert.equal(events[0].allDay, true);
});

test("daily note comma titles render as explicit single-day all-day events", async () => {
  const { dailyNoteSummariesToCalendarEvents } = await loadCalendarDailyNotes();

  const events = dailyNoteSummariesToCalendarEvents(
    [{ id: "note-2", title: "2026-04-21,2026-04-23,2026-04-25" }],
    new Date("2026-04-01T00:00:00"),
    new Date("2026-04-30T23:59:59"),
  );

  assert.deepEqual(
    events.map((event) => [event.id, event.startTime, event.endTime]),
    [
      ["note-2:2026-04-21", "2026-04-21", "2026-04-22"],
      ["note-2:2026-04-23", "2026-04-23", "2026-04-24"],
      ["note-2:2026-04-25", "2026-04-25", "2026-04-26"],
    ],
  );
});
