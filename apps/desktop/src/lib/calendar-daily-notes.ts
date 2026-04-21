import { addDays, format, startOfDay } from "date-fns";
import type { CalendarEvent } from "@slate/shared";

/** Full-string title is exactly one calendar day (legacy / strict match). */
export const ISO_DATE_TITLE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const SLATE_DAILY_NOTE_SOURCE = "slate-daily-note";

const DAILY_NOTE_COLOR = "#5b8cff";

/** Synthetic calendar events use `id` = `{noteUuid}:{yyyy-MM-dd}`; recover the note primary key. */
export function noteIdFromDailyNoteCalendarEvent(event: { id: string; source: string }): string {
  if (event.source !== SLATE_DAILY_NOTE_SOURCE) return event.id;
  const i = event.id.indexOf(":");
  return i === -1 ? event.id : event.id.slice(0, i);
}

function isValidIsoCalendarDate(isoYmd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoYmd)) return false;
  const d = new Date(`${isoYmd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}` === isoYmd;
}

function parseLocalDayFromIsoYmd(isoYmd: string): Date | null {
  if (!isValidIsoCalendarDate(isoYmd)) return null;
  return new Date(`${isoYmd}T12:00:00`);
}

/**
 * Unique calendar dates (yyyy-MM-dd) embedded anywhere in the title, in first-seen order.
 * Examples: "2026-01-01", "daily note 2026-01-01", "2026-01-01 daily notes",
 * "daily notes 2026-01-01 daily notes" → all yield ["2026-01-01"].
 */
export function extractIsoDatesFromNoteTitle(title: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /\d{4}-\d{2}-\d{2}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(title)) !== null) {
    const segment = match[0];
    if (!isValidIsoCalendarDate(segment) || seen.has(segment)) continue;
    seen.add(segment);
    out.push(segment);
  }
  return out;
}

export function isIsoDateNoteTitle(title: string): boolean {
  const t = title.trim();
  if (!ISO_DATE_TITLE_PATTERN.test(t)) return false;
  const dates = extractIsoDatesFromNoteTitle(t);
  return dates.length === 1 && dates[0] === t;
}

type DailyNoteCalendarEventSpec = {
  idSuffix: string;
  startIso: string;
  exclusiveEndIso: string;
};

const EXACT_DATE_RANGE_TITLE_PATTERN = /^(\d{4}-\d{2}-\d{2})\s*->\s*(\d{4}-\d{2}-\d{2})$/;
const EXACT_DATE_LIST_TITLE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:\s*,\s*\d{4}-\d{2}-\d{2})+$/;

function exclusiveEndIsoForDay(iso: string): string | null {
  const midday = parseLocalDayFromIsoYmd(iso);
  if (!midday) return null;
  return format(addDays(startOfDay(midday), 1), "yyyy-MM-dd");
}

function exactTitleToCalendarEventSpecs(title: string): DailyNoteCalendarEventSpec[] | null {
  const t = title.trim();
  const rangeMatch = EXACT_DATE_RANGE_TITLE_PATTERN.exec(t);
  if (rangeMatch) {
    const [, startIso, endIso] = rangeMatch;
    const startMidday = parseLocalDayFromIsoYmd(startIso);
    const endExclusiveIso = exclusiveEndIsoForDay(endIso);
    if (!startMidday || !endExclusiveIso || startIso > endIso) return [];
    return [
      {
        idSuffix: `${startIso}:${endIso}`,
        startIso,
        exclusiveEndIso: endExclusiveIso,
      },
    ];
  }

  if (EXACT_DATE_LIST_TITLE_PATTERN.test(t)) {
    const seen = new Set<string>();
    const specs: DailyNoteCalendarEventSpec[] = [];
    for (const iso of t.split(",").map((segment) => segment.trim())) {
      if (seen.has(iso)) continue;
      const exclusiveEndIso = exclusiveEndIsoForDay(iso);
      if (!exclusiveEndIso) return [];
      seen.add(iso);
      specs.push({ idSuffix: iso, startIso: iso, exclusiveEndIso });
    }
    return specs;
  }

  return null;
}

function legacyDateTitleToCalendarEventSpecs(title: string): DailyNoteCalendarEventSpec[] {
  return extractIsoDatesFromNoteTitle(title).flatMap((iso) => {
    const exclusiveEndIso = exclusiveEndIsoForDay(iso);
    return exclusiveEndIso ? [{ idSuffix: iso, startIso: iso, exclusiveEndIso }] : [];
  });
}

function eventSpecOverlapsRange(
  spec: DailyNoteCalendarEventSpec,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  const eventStart = startOfDay(parseLocalDayFromIsoYmd(spec.startIso)!);
  const eventExclusiveEnd = startOfDay(parseLocalDayFromIsoYmd(spec.exclusiveEndIso)!);
  return eventExclusiveEnd > rangeStart && eventStart <= rangeEnd;
}

/**
 * Build all-day calendar rows for date-based notes:
 * - exact `YYYY-MM-DD -> YYYY-MM-DD` titles render as one inclusive multi-day event
 * - exact `YYYY-MM-DD,YYYY-MM-DD,...` titles render as explicit single-day events
 * - legacy titles containing dates render one event per distinct date
 */
export function dailyNoteSummariesToCalendarEvents(
  notes: Array<{ id: string; title: string }>,
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const note of notes) {
    const specs =
      exactTitleToCalendarEventSpecs(note.title) ?? legacyDateTitleToCalendarEventSpecs(note.title);
    if (specs.length === 0) continue;

    for (const spec of specs) {
      if (!eventSpecOverlapsRange(spec, rangeStart, rangeEnd)) continue;

      out.push({
        id: `${note.id}:${spec.idSuffix}`,
        subscriptionId: SLATE_DAILY_NOTE_SOURCE,
        calendarId: SLATE_DAILY_NOTE_SOURCE,
        source: SLATE_DAILY_NOTE_SOURCE,
        title: note.title.trim(),
        startTime: spec.startIso,
        endTime: spec.exclusiveEndIso,
        allDay: true,
        color: DAILY_NOTE_COLOR,
        readOnly: true,
        calendarName: "Daily notes",
      });
    }
  }
  return out;
}
