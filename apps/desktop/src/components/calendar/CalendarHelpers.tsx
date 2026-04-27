import { useState } from "react";
import { dateFnsLocalizer, type View } from "react-big-calendar";
import TimeGrid from "react-big-calendar/lib/TimeGrid";
import type { CalendarEvent, CalendarEventAttendee } from "@slate/shared";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  getDay,
  parse,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import enUS from "date-fns/locale/en-US";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";
import { AttendeeAvatar } from "./AttendeeAvatar";

export const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay,
  locales: { "en-US": enUS },
});

export function ThreeDayView(props: any) {
  const { date, localizer, min, max, scrollToTime, enableAutoScroll, ...rest } = props;
  return (
    <TimeGrid
      {...rest}
      range={ThreeDayView.range(date)}
      localizer={localizer}
      min={min ?? localizer.startOf(new Date(), "day")}
      max={max ?? localizer.endOf(new Date(), "day")}
      scrollToTime={scrollToTime ?? localizer.startOf(new Date(), "day")}
      enableAutoScroll={enableAutoScroll ?? true}
      eventOffset={15}
    />
  );
}
ThreeDayView.range = (date: Date) => {
  const start = startOfDay(date);
  return [start, addDays(start, 1), addDays(start, 2)];
};
ThreeDayView.navigate = (date: Date, action: string) => {
  switch (action) {
    case "PREV":
      return subDays(date, 3);
    case "NEXT":
      return addDays(date, 3);
    default:
      return date;
  }
};
ThreeDayView.title = (date: Date) => {
  const end = addDays(date, 2);
  return `${format(date, "MMM d")} – ${format(end, "MMM d")}`;
};

export const RESPONSE_INDICATOR: Record<string, string> = {
  accepted: "text-green-400",
  declined: "text-red-400",
  tentative: "text-yellow-400",
  needsAction: "text-faint",
};

export interface BigCalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: CalendarEvent;
}

export function AttendeeList({
  attendees,
}: {
  attendees: CalendarEventAttendee[];
  subscriptionId?: string;
  provider?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-1.5 bg-transparent border-0 p-0 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint hover:text-muted-foreground"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        Attendees ({attendees.length})
      </button>
      {expanded ? (
        <div className="mt-1.5 flex flex-col gap-1">
          {attendees.map((a) => (
            <div
              key={a.email}
              className="flex items-start gap-2 text-[0.75rem] text-muted-foreground"
            >
              <div className="relative shrink-0">
                <AttendeeAvatar
                  name={a.displayName}
                  email={a.email}
                  photoUrl={a.photoUrl}
                  className="size-5"
                />
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-panel-elevated",
                    RESPONSE_INDICATOR[a.responseStatus ?? "needsAction"] ?? "text-faint",
                  )}
                  style={{ backgroundColor: "currentColor" }}
                />
              </div>
              <div className="min-w-0">
                <div className="truncate">{a.displayName || a.email}</div>
              </div>
              {a.self ? <span className="mt-0.5 text-[0.6rem] text-faint">(you)</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function shortTime(date: Date): string {
  const minutes = date.getMinutes();
  return minutes === 0 ? format(date, "ha").toLowerCase() : format(date, "h:mma").toLowerCase();
}

export function displayEventTitle(title?: string): string {
  const normalized = title?.trim() ?? "";
  return !normalized || /^untitled(?:\s+event)?$/i.test(normalized) ? "Busy" : normalized;
}

export function EventBlock({ event }: { event: BigCalendarEvent }) {
  const time = !event.allDay ? shortTime(event.start) : null;
  return (
    <span className="min-w-0">
      <span className="inline-flex min-w-0 items-center gap-2">
        <span
          className="event-block-dot hidden size-2 shrink-0 rounded-full"
          style={{ backgroundColor: event.resource.color || "#7c5cdc" }}
        />
        <span className="truncate">{displayEventTitle(event.title)}</span>
      </span>
      {time ? (
        <span className="event-block-time shrink-0 text-[0.55rem] opacity-60">{time}</span>
      ) : null}
    </span>
  );
}

export function labelForView(view: View) {
  switch (view) {
    case "day":
      return "Day";
    case "work_week":
      return "3 Day";
    case "week":
      return "Week";
    case "agenda":
      return "Agenda";
    case "month":
    default:
      return "Month";
  }
}

export function mapCalendarEventsToBigCalendar(rawEvents: CalendarEvent[]): BigCalendarEvent[] {
  return rawEvents.map((event) => {
    // Date-only strings (e.g. "2026-04-02") are parsed as UTC by
    // the Date constructor, which shifts them a day back in
    // western timezones. Appending T00:00:00 forces local-time parsing.
    const parseDate = (s: string) => (s.includes("T") ? new Date(s) : new Date(`${s}T00:00:00`));

    let start = parseDate(event.startTime);
    let end = parseDate(event.endTime);
    // All-day sources (Google, Slate daily-note ranges, ICS) use exclusive
    // ends — e.g. "April 1 all-day" → end: April 2 00:00, "April 24 -> April 27"
    // → end: April 28 00:00. react-big-calendar renders end inclusively, so
    // step back one millisecond to land on 23:59:59.999 of the last inclusive
    // day. Subtracting a full day instead would strip the final day from
    // multi-day ranges (off-by-one).
    if (event.allDay) {
      end = new Date(end.getTime() - 1);
    }
    return {
      id: `${event.source}:${event.calendarId}:${event.id}`,
      title: event.title,
      start,
      end,
      allDay: event.allDay,
      resource: event,
    };
  });
}

export function filterAndMapEvents(
  rawEvents: CalendarEvent[],
  selectedCalendarIds: string[],
  selectedProviderCalendarIds: string[],
  selectedIcsIds: string[],
): BigCalendarEvent[] {
  const selectedProviderSubscriptions = new Set(selectedCalendarIds);
  const selectedProviderCalendars = new Set(selectedProviderCalendarIds);
  const selectedIcsSubscriptions = new Set(selectedIcsIds);

  const filtered = rawEvents.filter((event) => {
    if (event.source === "ics") {
      return event.subscriptionId
        ? selectedIcsSubscriptions.has(event.subscriptionId)
        : selectedIcsSubscriptions.has(event.calendarId);
    }
    return event.subscriptionId
      ? selectedProviderSubscriptions.has(event.subscriptionId)
      : selectedProviderCalendars.has(event.calendarId);
  });

  return mapCalendarEventsToBigCalendar(filtered);
}

export function computePopoverPosition(
  calendarBounds: DOMRect,
  eventBounds: DOMRect,
): { left: number; top: number } {
  const desiredLeft = eventBounds.left - calendarBounds.left;
  const maxLeft = Math.max(16, calendarBounds.width - 292);
  const popoverHeight = 200; // approximate popover height
  const spaceBelow = calendarBounds.bottom - eventBounds.bottom;
  const spaceAbove = eventBounds.top - calendarBounds.top;

  let top: number;
  if (spaceBelow >= popoverHeight + 8) {
    top = eventBounds.bottom - calendarBounds.top + 8;
  } else if (spaceAbove >= popoverHeight + 8) {
    top = eventBounds.top - calendarBounds.top - popoverHeight - 8;
  } else {
    // Not enough space either way — clamp to bottom of container
    top = calendarBounds.height - popoverHeight - 16;
  }

  return {
    left: Math.min(Math.max(16, desiredLeft), maxLeft),
    top: Math.max(8, top),
  };
}

export function getEventStyle(event: BigCalendarEvent, view: View) {
  const color = event.resource.color || "#7c5cdc";
  const selfAttendee = event.resource.attendees?.find((a) => a.self);
  const rsvp = selfAttendee?.responseStatus;
  const declined = rsvp === "declined";
  const tentative = rsvp === "tentative";
  const needsAction = rsvp === "needsAction";

  if (view === "agenda") {
    return {
      style: {
        backgroundColor: "transparent",
        border: "none",
        borderTop: "none",
        borderRight: "none",
        borderBottom: "none",
        borderLeft: "none",
        borderRadius: "0",
        color: declined ? "var(--text-faint)" : "var(--text)",
        boxShadow: "none",
        fontSize: "0.74rem",
        fontWeight: "500",
        letterSpacing: "0.01em",
        padding: "0",
        backdropFilter: "none",
        opacity: declined ? 0.45 : needsAction ? 0.7 : 1,
        textDecoration: declined ? "line-through" : "none",
      },
    };
  }

  return {
    style: {
      backgroundColor: "var(--calendar-event)",
      borderLeft: `3px solid ${declined ? "var(--text-faint)" : color}`,
      borderTop: "1px solid var(--calendar-grid)",
      borderRight: "1px solid var(--calendar-grid)",
      borderBottom: "1px solid var(--calendar-grid)",
      borderRadius: "6px",
      color: declined ? "var(--text-faint)" : "var(--text)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      fontSize: "0.74rem",
      fontWeight: "500",
      letterSpacing: "0.01em",
      padding: "2px 7px",
      backdropFilter: "blur(12px)",
      opacity: declined ? 0.45 : needsAction ? 0.7 : 1,
      textDecoration: declined ? "line-through" : "none",
      borderStyle: tentative || needsAction ? "dotted" : "solid",
      borderLeftStyle: "solid" as const,
    },
  };
}

export function getViewRange(targetDate: Date, view: View): { start: Date; end: Date } {
  switch (view) {
    case "day":
      return { start: subDays(startOfDay(targetDate), 1), end: addDays(endOfDay(targetDate), 1) };
    case "work_week":
      return { start: subDays(startOfDay(targetDate), 1), end: addDays(endOfDay(targetDate), 3) };
    case "week":
      return {
        start: subWeeks(startOfWeek(targetDate, { weekStartsOn: 0 }), 1),
        end: addWeeks(endOfWeek(targetDate, { weekStartsOn: 0 }), 1),
      };
    case "agenda":
      return { start: startOfDay(targetDate), end: addMonths(targetDate, 1) };
    case "month":
    default:
      return {
        start: subMonths(startOfMonth(targetDate), 1),
        end: addMonths(endOfMonth(targetDate), 1),
      };
  }
}
