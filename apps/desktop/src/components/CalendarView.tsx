import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar as BigCalendar, dateFnsLocalizer, type View } from "react-big-calendar";
import type { CalendarEvent } from "@slate/shared";
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
import { cn } from "../lib/utils";
import { fetchCalendarEvents } from "../lib/api";
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

interface CalendarViewProps {
  backendAuthenticated: boolean;
  backendReachable: boolean;
  selectedCalendarIds: string[];
  selectedProviderCalendarIds: string[];
  selectedIcsIds: string[];
  calendarNameBySourceId: Record<string, string>;
  canCreateEvent: boolean;
  createEventDisabledReason: string;
  onCreateEvent: () => void;
}

interface BigCalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: CalendarEvent;
}

const VIEW_LABEL: Record<"month" | "week" | "day" | "agenda", string> = {
  month: "Month",
  week: "Week",
  day: "Day",
  agenda: "Agenda",
};

function labelForView(view: View) {
  switch (view) {
    case "day":
      return VIEW_LABEL.day;
    case "week":
    case "work_week":
      return VIEW_LABEL.week;
    case "agenda":
      return VIEW_LABEL.agenda;
    case "month":
    default:
      return VIEW_LABEL.month;
  }
}

function getViewRange(targetDate: Date, view: View): { start: Date; end: Date } {
  switch (view) {
    case "day":
      return { start: subDays(startOfDay(targetDate), 1), end: addDays(endOfDay(targetDate), 1) };
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
}: CalendarViewProps) {
  const [view, setView] = useState<View>("month");
  const [date, setDate] = useState(new Date());
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
            .map((event) => ({
              id: `${event.source}:${event.calendarId}:${event.id}`,
              title: event.title,
              start: new Date(event.startTime),
              end: new Date(event.endTime),
              allDay: event.allDay,
              resource: event,
            })),
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
    return {
      style: {
        backgroundColor: event.resource.color || "rgba(124, 92, 220, 0.24)",
        border: `1px solid ${event.resource.color || "rgba(124, 92, 220, 0.42)"}`,
        borderRadius: "8px",
        color: "#fafaf9",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
        fontSize: "0.74rem",
        fontWeight: "500",
        letterSpacing: "0.01em",
        padding: "2px 7px",
      },
    };
  }, []);

  const handleSelectEvent = useCallback(
    (event: BigCalendarEvent, targetEvent: React.SyntheticEvent<HTMLElement> | Event) => {
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
      const desiredTop = eventBounds.bottom - calendarBounds.top + 8;
      const maxLeft = Math.max(16, calendarBounds.width - 292);

      setSelectedEvent(event);
      setPopoverPosition({
        left: Math.min(Math.max(16, desiredLeft), maxLeft),
        top: desiredTop,
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
                {(["month", "week", "day", "agenda"] as View[]).map((nextView) => (
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
    >
      <BigCalendar
        localizer={localizer}
        events={events}
        view={view}
        date={date}
        onView={setView}
        onNavigate={setDate}
        onSelectEvent={handleSelectEvent}
        eventPropGetter={eventStyleGetter}
        components={{ toolbar: CustomToolbar }}
        popup
        style={{ flex: 1 }}
      />
      {selectedEvent ? (
        <div
          ref={popoverRef}
          className="calendar-view__event-popover rounded-[14px] border border-border bg-panel-elevated p-3 shadow-[0_22px_44px_rgba(0,0,0,0.34)]"
          style={
            popoverPosition ? { left: popoverPosition.left, top: popoverPosition.top } : undefined
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
              <div className="text-[0.88rem] font-semibold leading-[1.25] text-foreground">
                {selectedEvent.title || "Untitled event"}
              </div>
              <div className="mt-1 text-[0.74rem] leading-[1.35] text-muted-foreground">
                {selectedEventTiming}
              </div>
            </div>
          </div>
          {selectedEvent.resource.location ? (
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint">
                Location
              </div>
              <div className="text-[0.78rem] leading-[1.45] text-muted-foreground">
                {selectedEvent.resource.location}
              </div>
            </div>
          ) : null}
          {selectedEvent.resource.description ? (
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint">
                Details
              </div>
              <div className="whitespace-pre-wrap text-[0.78rem] leading-[1.45] text-muted-foreground">
                {selectedEvent.resource.description}
              </div>
            </div>
          ) : null}
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-faint">
            {/* calendar name */}
            <span>{selectedEventCalendarName}</span>
            {selectedEvent.resource.htmlLink ? (
              <a
                href={selectedEvent.resource.htmlLink}
                className="text-muted-foreground transition-colors hover:text-foreground"
                target="_blank"
                rel="noreferrer"
              >
                Open
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
