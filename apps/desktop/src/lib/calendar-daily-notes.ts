import { addDays, endOfDay, format, startOfDay } from "date-fns";
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

/**
 * Build all-day calendar rows for notes whose title contains at least one valid YYYY-MM-DD,
 * one row per distinct date in the title whose day overlaps the fetch range.
 */
export function dailyNoteSummariesToCalendarEvents(
  notes: Array<{ id: string; title: string }>,
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const note of notes) {
    const dates = extractIsoDatesFromNoteTitle(note.title);
    if (dates.length === 0) continue;

    for (const iso of dates) {
      const midday = parseLocalDayFromIsoYmd(iso);
      if (!midday) continue;
      const dayStart = startOfDay(midday);
      const dayEnd = endOfDay(midday);
      if (dayEnd < rangeStart || dayStart > rangeEnd) continue;

      const exclusiveEnd = format(addDays(dayStart, 1), "yyyy-MM-dd");

      out.push({
        id: `${note.id}:${iso}`,
        subscriptionId: SLATE_DAILY_NOTE_SOURCE,
        calendarId: SLATE_DAILY_NOTE_SOURCE,
        source: SLATE_DAILY_NOTE_SOURCE,
        title: note.title.trim(),
        startTime: iso,
        endTime: exclusiveEnd,
        allDay: true,
        color: DAILY_NOTE_COLOR,
        readOnly: true,
        calendarName: "Daily notes",
      });
    }
  }
  return out;
}
