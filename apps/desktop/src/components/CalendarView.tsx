import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar as BigCalendar, dateFnsLocalizer, type View, Views } from "react-big-calendar";
export type { View as CalendarViewType } from "react-big-calendar";
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
  isSameDay,
} from "date-fns";
import enUS from "date-fns/locale/en-US";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Plus, WifiOff } from "lucide-react";
import DOMPurify from "dompurify";
import { cn } from "../lib/utils";
import { fetchCalendarEvents, rsvpCalendarEvent, showContextMenu } from "../lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { Button } from "./ui/button";

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay,
  locales: { "en-US": enUS },
});

function ThreeDayView(props: any) {
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

const RESPONSE_INDICATOR: Record<string, string> = {
  accepted: "text-green-400",
  declined: "text-red-400",
  tentative: "text-yellow-400",
  needsAction: "text-faint",
};

function AttendeeList({ attendees }: { attendees: CalendarEventAttendee[] }) {
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
            <div key={a.email} className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
              <span className={cn("size-1.5 shrink-0 rounded-full", RESPONSE_INDICATOR[a.responseStatus ?? "needsAction"] ?? "text-faint")} style={{ backgroundColor: "currentColor" }} />
              <span className="truncate">{a.displayName || a.email}</span>
              {a.self ? <span className="text-[0.6rem] text-faint">(you)</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function shortTime(date: Date): string {
  const minutes = date.getMinutes();
  return minutes === 0
    ? format(date, "ha").toLowerCase()
    : format(date, "h:mma").toLowerCase();
}

function EventBlock({ event }: { event: BigCalendarEvent }) {
  const time = !event.allDay ? shortTime(event.start) : null;
  return (
    <span className="min-w-0">
      <span>{event.title || "Untitled"}</span>
      {time ? (
        <span className="event-block-time shrink-0 text-[0.55rem] opacity-60">{time}</span>
      ) : null}
    </span>
  );
}

interface CalendarViewProps {
  backendAuthenticated: boolean;
  backendReachable: boolean;
  selectedCalendarIds: string[];
  selectedProviderCalendarIds: string[];
  selectedIcsIds: string[];
  calendarNameBySourceId: Record<string, string>;
  canCreateEvent: boolean;
  createEventDisabledReason: string;
  onCreateEvent: (slotInfo?: { start: Date; end: Date; allDay: boolean }) => void;
  onDeleteEvent: (subscriptionId: string, eventId: string) => Promise<void>;
  view: View;
  onViewChange: (view: View) => void;
  date: Date;
  onDateChange: (date: Date) => void;
}

interface BigCalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: CalendarEvent;
}

function labelForView(view: View) {
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

function getViewRange(targetDate: Date, view: View): { start: Date; end: Date } {
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

export function CalendarView({
  backendAuthenticated,
  backendReachable,
  selectedCalendarIds,
  selectedProviderCalendarIds,
  selectedIcsIds,
  calendarNameBySourceId,
  canCreateEvent,
  createEventDisabledReason,
  onCreateEvent,
  onDeleteEvent,
  view,
  onViewChange: setView,
  date,
  onDateChange: setDate,
}: CalendarViewProps) {
  const [events, setEvents] = useState<BigCalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<BigCalendarEvent | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(
    null,
  );
  const calendarRootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const loadEvents = useCallback(
    async (targetDate: Date, currentView: View) => {
      if (!backendAuthenticated || !backendReachable) {
        setEvents([]);
        return;
      }

      setLoading(true);
      try {
        const { start, end } = getViewRange(targetDate, currentView);
        const result = await fetchCalendarEvents({
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
        });
        const selectedProviderSubscriptions = new Set(selectedCalendarIds);
        const selectedProviderCalendars = new Set(selectedProviderCalendarIds);
        const selectedIcsSubscriptions = new Set(selectedIcsIds);
        setEvents(
          (result.events ?? [])
            .filter((event) => {
              if (event.source === "ics") {
                return event.subscriptionId
                  ? selectedIcsSubscriptions.has(event.subscriptionId)
                  : selectedIcsSubscriptions.has(event.calendarId);
              }
              return event.subscriptionId
                ? selectedProviderSubscriptions.has(event.subscriptionId)
                : selectedProviderCalendars.has(event.calendarId);
            })
            .map((event) => {
              let end = new Date(event.endTime);
              // Google returns exclusive end dates for all-day events
              // (e.g. April 1 all-day → end: April 2). Subtract a day so
              // react-big-calendar renders them as single-day.
              if (event.allDay) {
                end = subDays(end, 1);
              }
              return {
                id: `${event.source}:${event.calendarId}:${event.id}`,
                title: event.title,
                start: new Date(event.startTime),
                end,
                allDay: event.allDay,
                resource: event,
              };
            }),
        );
      } catch {
        setEvents([]);
      } finally {
        setLoading(false);
      }
    },
    [
      backendAuthenticated,
      backendReachable,
      selectedCalendarIds,
      selectedIcsIds,
      selectedProviderCalendarIds,
    ],
  );

  useEffect(() => {
    void loadEvents(date, view);
  }, [date, loadEvents, view]);

  useEffect(() => {
    if (!backendAuthenticated || !backendReachable) return;
    const id = window.setInterval(() => {
      void loadEvents(date, view);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [backendAuthenticated, backendReachable, date, loadEvents, view]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!selectedEvent) return;
      const target = event.target as Node | null;
      if (popoverRef.current?.contains(target)) return;
      if ((target as HTMLElement | null)?.closest?.(".rbc-event")) return;
      setSelectedEvent(null);
      setPopoverPosition(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedEvent(null);
      setPopoverPosition(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedEvent]);

  useEffect(() => {
    if (!selectedEvent) return;

    const previousOverflow = document.body.style.overflow;
    const preventScroll = (event: Event) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("wheel", preventScroll, { passive: false });
    document.addEventListener("touchmove", preventScroll, { passive: false });

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("wheel", preventScroll);
      document.removeEventListener("touchmove", preventScroll);
    };
  }, [selectedEvent]);

  const eventStyleGetter = useCallback((event: BigCalendarEvent) => {
    const color = event.resource.color || "#7c5cdc";
    const selfAttendee = event.resource.attendees?.find((a) => a.self);
    const rsvp = selfAttendee?.responseStatus;
    const declined = rsvp === "declined";
    const tentative = rsvp === "tentative";
    const needsAction = rsvp === "needsAction";
    return {
      style: {
        backgroundColor: "var(--calendar-event)",
        borderLeft: `3px solid ${declined ? "var(--text-faint)" : color}`,
        borderTop: '1px solid var(--calendar-grid)',
        borderRight: '1px solid var(--calendar-grid)',
        borderBottom: '1px solid var(--calendar-grid)',
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
  }, []);

  const handleSelectEvent = useCallback(
    (event: BigCalendarEvent, targetEvent: React.SyntheticEvent<HTMLElement> | Event) => {
      // Dismiss the "+N more" overlay so the event popover isn't obscured
      requestAnimationFrame(() => {
        document.querySelectorAll<HTMLElement>(".rbc-overlay").forEach((el) => {
          el.style.display = "none";
        });
      });

      const calendarBounds = calendarRootRef.current?.getBoundingClientRect();
      const currentTarget = targetEvent.currentTarget;
      const target =
        currentTarget instanceof HTMLElement
          ? currentTarget
          : targetEvent.target instanceof Element
            ? targetEvent.target.closest(".rbc-event")
            : null;

      if (!calendarBounds || !(target instanceof HTMLElement)) {
        setSelectedEvent(event);
        setPopoverPosition(null);
        return;
      }

      const eventBounds = target.getBoundingClientRect();
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

      setSelectedEvent(event);
      setPopoverPosition({
        left: Math.min(Math.max(16, desiredLeft), maxLeft),
        top: Math.max(8, top),
      });
    },
    [],
  );

  const selectedEventTiming = useMemo(() => {
    if (!selectedEvent) return "";
    if (selectedEvent.allDay) {
      return isSameDay(selectedEvent.start, selectedEvent.end)
        ? format(selectedEvent.start, "EEEE, MMM d")
        : `${format(selectedEvent.start, "EEE, MMM d")} - ${format(selectedEvent.end, "EEE, MMM d")}`;
    }

    return isSameDay(selectedEvent.start, selectedEvent.end)
      ? `${format(selectedEvent.start, "EEEE, MMM d")} · ${format(selectedEvent.start, "p")} - ${format(selectedEvent.end, "p")}`
      : `${format(selectedEvent.start, "EEE, MMM d, p")} - ${format(selectedEvent.end, "EEE, MMM d, p")}`;
  }, [selectedEvent]);

  const selectedEventCalendarName = useMemo(() => {
    if (!selectedEvent) return "";
    const subscriptionId = selectedEvent.resource.subscriptionId;
    if (subscriptionId && calendarNameBySourceId[subscriptionId]) {
      return calendarNameBySourceId[subscriptionId];
    }
    if (calendarNameBySourceId[selectedEvent.resource.calendarId]) {
      return calendarNameBySourceId[selectedEvent.resource.calendarId];
    }
    return selectedEvent.resource.calendarName || selectedEvent.resource.source.toUpperCase();
  }, [calendarNameBySourceId, selectedEvent]);

  const CustomToolbar = useMemo(() => {
    return function Toolbar({ label }: { label: string }) {
      return (
        <div className="calendar-view__toolbar flex items-center justify-between gap-4 px-5 py-3 [-webkit-app-region:no-drag] max-md:flex-col max-md:items-stretch">
          <div className="flex min-w-0 items-center gap-3">
            <div className="calendar-view__nav-cluster flex items-center gap-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setDate((current) => {
                    const next = new Date(current);
                    if (view === "month") next.setMonth(next.getMonth() - 1);
                    else if (view === "week") next.setDate(next.getDate() - 7);
                    else if (view === "work_week") next.setDate(next.getDate() - 3);
                    else next.setDate(next.getDate() - 1);
                    return next;
                  });
                }}
                aria-label="Previous period"
              >
                <ChevronLeft size={12} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setDate((current) => {
                    const next = new Date(current);
                    if (view === "month") next.setMonth(next.getMonth() + 1);
                    else if (view === "week") next.setDate(next.getDate() + 7);
                    else if (view === "work_week") next.setDate(next.getDate() + 3);
                    else next.setDate(next.getDate() + 1);
                    return next;
                  });
                }}
                aria-label="Next period"
              >
                <ChevronRight size={12} />
              </Button>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <span className="calendar-view__label truncate">{label}</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-sm text-muted"
              // className="calendar-view__today-button"
              onClick={() => setDate(new Date())}
            >
              Today
            </Button>
            {loading ? <Loader2 size={14} className="animate-spin text-faint" /> : null}
          </div>

          <div className="flex items-center gap-2 max-md:justify-between">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="calendar-view__view-trigger text-sm"
                  aria-label="Change calendar view"
                >
                  <span>{labelForView(view)}</span>
                  <ChevronDown size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[140px]">
                {(["month", "week", "work_week", "day", "agenda"] as View[]).map((nextView) => (
                  <DropdownMenuItem
                    key={nextView}
                    className={cn(view === nextView && "bg-white/[0.08]", "text-sm")}
                    onSelect={() => setView(nextView)}
                  >
                    {labelForView(nextView)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={canCreateEvent ? onCreateEvent : undefined}
                    aria-label="Create event"
                    title="Create event"
                    disabled={!canCreateEvent}
                  >
                    <Plus size={14} />
                  </Button>
                </span>
              </TooltipTrigger>
              {!canCreateEvent ? (
                <TooltipContent side="bottom">{createEventDisabledReason}</TooltipContent>
              ) : null}
            </Tooltip>
          </div>
        </div>
      );
    };
  }, [canCreateEvent, createEventDisabledReason, loading, onCreateEvent, view]);

  if (!backendReachable || !backendAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <WifiOff size={24} className="text-faint" />
          <p className="m-0 text-[0.88rem] text-muted">
            {!backendReachable
              ? "Calendar requires a backend connection."
              : "Sign in to view your calendar."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={calendarRootRef}
      className="calendar-view relative flex h-full min-h-0 flex-col px-3 pb-3 pt-2"
      onContextMenu={async (e) => {
        e.preventDefault();
        const target = e.target instanceof HTMLElement ? e.target : null;
        const eventEl = target?.closest(".rbc-event") as HTMLElement | null;
        if (!eventEl) return;

        // Find the matching BigCalendarEvent by title + time
        const eventContent = eventEl.textContent ?? "";
        const match = events.find(
          (ev) => !ev.resource.readOnly && ev.resource.subscriptionId && eventContent.includes(ev.title),
        );
        if (!match) return;

        const selected = await showContextMenu([
          { id: "delete", label: "Delete Event" },
        ]);
        if (selected === "delete") {
          await onDeleteEvent(match.resource.subscriptionId!, match.resource.id);
          void loadEvents(date, view);
        }
      }}
    >
      <BigCalendar
        localizer={localizer}
        events={events}
        view={view}
        date={date}
        onView={setView}
        onNavigate={setDate}
        onSelectEvent={handleSelectEvent}
        onSelectSlot={
          canCreateEvent
            ? (slotInfo: { start: Date; end: Date; action: string }) => {
                if (view === "month" || view === "agenda") return;
                onCreateEvent({ start: slotInfo.start, end: slotInfo.end, allDay: false });
              }
            : undefined
        }
        selectable={canCreateEvent && view !== "month" && view !== "agenda"}
        eventPropGetter={eventStyleGetter}
        views={{ month: true, week: true, work_week: ThreeDayView, day: true, agenda: true }}
        components={{ toolbar: CustomToolbar, event: EventBlock }}
        popup
        style={{ flex: 1 }}
      />
      {selectedEvent ? (
        <div
          ref={popoverRef}
          className="calendar-view__event-popover overflow-y-auto overflow-x-hidden rounded-[14px] border border-border p-3 shadow-[0_22px_44px_rgba(0,0,0,0.34)]"
          style={
            popoverPosition
              ? {
                  left: popoverPosition.left,
                  top: popoverPosition.top,
                  maxHeight: `calc(100% - ${popoverPosition.top + 16}px)`,
                }
              : undefined
          }
        >
          <div className="flex items-start gap-2.5">
            <div
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                backgroundColor: selectedEvent.resource.color || "rgba(124, 92, 220, 0.88)",
              }}
            />
            <div className="min-w-0 flex-1">
              <div className="break-words text-[0.88rem] font-semibold leading-[1.25] text-foreground">
                {selectedEvent.title || "Untitled event"}
              </div>
              <div className="mt-1 break-words text-[0.74rem] leading-[1.35] text-muted-foreground">
                {selectedEventTiming}
              </div>
            </div>
          </div>
          {selectedEvent.resource.location ? (
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint">
                Location
              </div>
              <div className="break-words text-[0.78rem] leading-[1.45] text-muted-foreground">
                {selectedEvent.resource.location.startsWith("https://") ? (
                  <a
                    href={selectedEvent.resource.location}
                    className="text-muted-foreground underline hover:brightness-110"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {selectedEvent.resource.location}
                  </a>
                ) : (
                  selectedEvent.resource.location
                )}
              </div>
            </div>
          ) : null}
          {selectedEvent.resource.conferenceLink ? (
            <div className="mt-3 border-t border-border pt-3">
              <a
                href={selectedEvent.resource.conferenceLink}
                className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[0.78rem] text-muted-foreground transition-colors hover:bg-white/[0.1] hover:text-foreground"
                target="_blank"
                rel="noreferrer"
              >
                Join {selectedEvent.resource.conferenceName || "Meeting"}
              </a>
            </div>
          ) : null}
          {!selectedEvent.resource.readOnly &&
            selectedEvent.resource.subscriptionId &&
            selectedEvent.resource.attendees?.some((a) => a.self) ? (
            <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-3">
              <span className="mr-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint">
                RSVP
              </span>
              {(["accepted", "tentative", "declined"] as const).map((status) => {
                const selfAttendee = selectedEvent.resource.attendees?.find((a) => a.self);
                const isActive = selfAttendee?.responseStatus === status;
                const label = status === "accepted" ? "Yes" : status === "tentative" ? "Maybe" : "No";
                return (
                  <button
                    key={status}
                    type="button"
                    className={cn(
                      "cursor-pointer rounded-md border px-2 py-0.5 text-[0.72rem] font-medium transition-colors",
                      isActive
                        ? "border-white/20 bg-white/[0.1] text-foreground"
                        : "border-transparent bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08]",
                    )}
                    onClick={async () => {
                      await rsvpCalendarEvent({
                        subscriptionId: selectedEvent.resource.subscriptionId!,
                        eventId: selectedEvent.resource.id,
                        response: status,
                      });
                      void loadEvents(date, view);
                      setSelectedEvent(null);
                      setPopoverPosition(null);
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : null}
          {selectedEvent.resource.description ? (
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint">
                Details
              </div>
              <div
                className="calendar-event-description break-words text-[0.78rem] leading-[1.45] text-muted-foreground [&_a]:text-muted-foreground [&_a]:underline"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(selectedEvent.resource.description, {
                    ALLOWED_TAGS: ["a", "b", "i", "em", "strong", "br", "p", "ul", "ol", "li", "span"],
                    ALLOWED_ATTR: ["href", "target", "rel"],
                  }),
                }}
              />
            </div>
          ) : null}
          {selectedEvent.resource.attendees && selectedEvent.resource.attendees.length > 0 ? (
            <AttendeeList attendees={selectedEvent.resource.attendees} />
          ) : null}
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-2 text-[0.70rem] tracking-[0.08em] text-muted">
            <span>{selectedEventCalendarName}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
