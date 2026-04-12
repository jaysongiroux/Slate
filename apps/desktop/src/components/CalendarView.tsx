import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dailyNoteSummariesToCalendarEvents,
  noteIdFromDailyNoteCalendarEvent,
  SLATE_DAILY_NOTE_SOURCE,
} from "../lib/calendar-daily-notes";
import { Calendar as BigCalendar, type View } from "react-big-calendar";
export type { View as CalendarViewType } from "react-big-calendar";
import type { CalendarEvent } from "@slate/shared";
import { format, isSameDay } from "date-fns";
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  WifiOff,
} from "lucide-react";
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
import {
  localizer,
  ThreeDayView,
  EventBlock,
  labelForView,
  getEventStyle,
  getViewRange,
  computePopoverPosition,
  filterAndMapEvents,
  mapCalendarEventsToBigCalendar,
  type BigCalendarEvent,
} from "./calendar/CalendarHelpers";
import { EventPopover } from "./calendar/EventPopover";

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
  onEditEvent: (event: CalendarEvent) => void;
  view: View;
  onViewChange: (view: View) => void;
  date: Date;
  onDateChange: (date: Date) => void;
  refreshSignal?: number;
  /** Notes whose `title` is exactly `YYYY-MM-DD` can appear as all-day rows when enabled. */
  noteSummaries?: Array<{ id: string; title: string }>;
  showDailyNotesOnCalendar?: boolean;
  onOpenDailyNoteFromCalendar?: (noteId: string) => void;
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
  onEditEvent,
  view,
  onViewChange: setView,
  date,
  onDateChange: setDate,
  refreshSignal = 0,
  noteSummaries = [],
  showDailyNotesOnCalendar = false,
  onOpenDailyNoteFromCalendar,
}: CalendarViewProps) {
  const [remoteCalendarEvents, setRemoteCalendarEvents] = useState<BigCalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<BigCalendarEvent | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(
    null,
  );
  const [rsvpLoading, setRsvpLoading] = useState<string | null>(null);
  const scrollToTime = useMemo(() => {
    const now = new Date();
    now.setHours(now.getHours() - 1, 0, 0, 0);
    return now;
  }, []);

  const scrollToNowIndicator = useCallback(() => {
    const root = calendarRootRef.current;
    if (!root) return;
    const indicator = root.querySelector(".rbc-current-time-indicator");
    if (indicator) {
      indicator.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Fallback: scroll time-content to roughly current hour
    const timeContent = root.querySelector(".rbc-time-content");
    if (timeContent) {
      const now = new Date();
      const fraction = (now.getHours() * 60 + now.getMinutes()) / (24 * 60);
      const scrollTarget = timeContent.scrollHeight * fraction - timeContent.clientHeight / 2;
      timeContent.scrollTo({ top: Math.max(0, scrollTarget), behavior: "smooth" });
    }
  }, []);
  const calendarRootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const loadEvents = useCallback(
    async (targetDate: Date, currentView: View) => {
      if (!backendAuthenticated || !backendReachable) {
        setRemoteCalendarEvents([]);
        setLoadError("");
        return;
      }

      setLoading(true);
      try {
        const { start, end } = getViewRange(targetDate, currentView);
        const result = await fetchCalendarEvents({
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
        });
        setRemoteCalendarEvents(
          filterAndMapEvents(
            result.events ?? [],
            selectedCalendarIds,
            selectedProviderCalendarIds,
            selectedIcsIds,
          ),
        );
        setLoadError("");
      } catch (error) {
        console.error("[SlateCalendar] Failed to load calendar events", {
          error,
          view: currentView,
          date: targetDate.toISOString(),
        });
        setLoadError(error instanceof Error ? error.message : "Failed to load calendar events.");
        setRemoteCalendarEvents([]);
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

  const mergedCalendarEvents = useMemo(() => {
    if (!showDailyNotesOnCalendar) {
      return remoteCalendarEvents;
    }
    const { start, end } = getViewRange(date, view);
    const fromNotes = mapCalendarEventsToBigCalendar(
      dailyNoteSummariesToCalendarEvents(noteSummaries, start, end),
    );
    return [...remoteCalendarEvents, ...fromNotes];
  }, [remoteCalendarEvents, showDailyNotesOnCalendar, noteSummaries, date, view]);

  useEffect(() => {
    void loadEvents(date, view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

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
      event.stopPropagation();
      event.preventDefault();
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

  const eventStyleGetter = useCallback(
    (event: BigCalendarEvent) => getEventStyle(event, view),
    [view],
  );

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

      setSelectedEvent(event);
      setPopoverPosition(computePopoverPosition(calendarBounds, target.getBoundingClientRect()));
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

  const handleRsvp = useCallback(
    async (status: "accepted" | "tentative" | "declined") => {
      if (!selectedEvent) return;
      if (selectedEvent.resource.source === SLATE_DAILY_NOTE_SOURCE) return;
      setRsvpLoading(status);
      try {
        await rsvpCalendarEvent({
          subscriptionId: selectedEvent.resource.subscriptionId!,
          eventId: selectedEvent.resource.id,
          response: status,
        });
        void loadEvents(date, view);
        setSelectedEvent(null);
        setPopoverPosition(null);
      } finally {
        setRsvpLoading(null);
      }
    },
    [selectedEvent, loadEvents, date, view],
  );

  const handleEditFromPopover = useCallback(() => {
    if (!selectedEvent) return;
    if (selectedEvent.resource.source === SLATE_DAILY_NOTE_SOURCE) return;
    onEditEvent(selectedEvent.resource);
    setSelectedEvent(null);
    setPopoverPosition(null);
  }, [selectedEvent, onEditEvent]);

  const handleOpenDailyNoteFromPopover = useCallback(() => {
    if (!selectedEvent || selectedEvent.resource.source !== SLATE_DAILY_NOTE_SOURCE) return;
    const noteId = noteIdFromDailyNoteCalendarEvent(selectedEvent.resource);
    setSelectedEvent(null);
    setPopoverPosition(null);
    onOpenDailyNoteFromCalendar?.(noteId);
  }, [selectedEvent, onOpenDailyNoteFromCalendar]);

  const handleDismissPopover = useCallback(() => {
    setSelectedEvent(null);
    setPopoverPosition(null);
  }, []);

  const CustomToolbar = useMemo(() => {
    return function Toolbar({ label }: { label: string }) {
      return (
        <div className="calendar-view__toolbar flex items-center justify-between gap-4 px-5 py-3 [-webkit-app-region:no-drag] max-xs:flex-col max-md:items-stretch">
          <div className="flex min-w-0 items-center gap-3">
            <div className="calendar-view__nav-cluster flex items-center gap-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  const next = new Date(date);
                  if (view === "month") next.setMonth(next.getMonth() - 1);
                  else if (view === "week") next.setDate(next.getDate() - 7);
                  else if (view === "work_week") next.setDate(next.getDate() - 3);
                  else next.setDate(next.getDate() - 1);
                  setDate(next);
                }}
                aria-label="Previous period"
              >
                <ChevronLeft size={12} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  const next = new Date(date);
                  if (view === "month") next.setMonth(next.getMonth() + 1);
                  else if (view === "week") next.setDate(next.getDate() + 7);
                  else if (view === "work_week") next.setDate(next.getDate() + 3);
                  else next.setDate(next.getDate() + 1);
                  setDate(next);
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
              onClick={() => {
                setDate(new Date());
                if (view !== "month" && view !== "agenda") {
                  // Wait for React to re-render with the new date before scrolling
                  requestAnimationFrame(() => requestAnimationFrame(() => scrollToNowIndicator()));
                }
              }}
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void loadEvents(date, view)}
              aria-label="Refresh calendar"
              disabled={loading}
            >
              {loading ? (
                <Loader2 size={14} className="animate-spin text-faint" />
              ) : (
                <RefreshCw size={14} className="text-muted" />
              )}
            </Button>
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
                    onClick={canCreateEvent ? () => onCreateEvent() : undefined}
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
  }, [
    canCreateEvent,
    createEventDisabledReason,
    date,
    loadEvents,
    loading,
    onCreateEvent,
    scrollToNowIndicator,
    view,
  ]);

  const canRenderCalendarGrid =
    (backendReachable && backendAuthenticated) || showDailyNotesOnCalendar;

  if (!canRenderCalendarGrid) {
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
        const match = mergedCalendarEvents.find((ev) => {
          if (ev.resource.source === SLATE_DAILY_NOTE_SOURCE) {
            return eventContent.includes(ev.title);
          }
          return (
            !ev.resource.readOnly && ev.resource.subscriptionId && eventContent.includes(ev.title)
          );
        });
        if (!match) return;

        if (match.resource.source === SLATE_DAILY_NOTE_SOURCE) {
          const selected = await showContextMenu([{ id: "open", label: "Open note" }]);
          if (selected === "open") {
            onOpenDailyNoteFromCalendar?.(noteIdFromDailyNoteCalendarEvent(match.resource));
          }
          return;
        }

        const selected = await showContextMenu([
          { id: "edit", label: "Edit Event" },
          { id: "delete", label: "Delete Event" },
        ]);
        if (selected === "edit") {
          onEditEvent(match.resource);
        } else if (selected === "delete") {
          await onDeleteEvent(match.resource.subscriptionId!, match.resource.id);
          void loadEvents(date, view);
        }
      }}
    >
      {loadError ? (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/8 px-3 py-2 text-[0.8rem] text-red-200">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span className="leading-snug">
            Calendar events failed to load. Check the console for details.
          </span>
        </div>
      ) : null}
      <BigCalendar
        localizer={localizer}
        events={mergedCalendarEvents}
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
        scrollToTime={scrollToTime}
        views={{ month: true, week: true, work_week: ThreeDayView, day: true, agenda: true }}
        components={{ toolbar: CustomToolbar, event: EventBlock }}
        popup
        style={{ flex: 1 }}
      />
      <EventPopover
        event={selectedEvent}
        popoverPosition={popoverPosition}
        popoverRef={popoverRef}
        timing={selectedEventTiming}
        calendarName={selectedEventCalendarName}
        rsvpLoading={rsvpLoading}
        onRsvp={handleRsvp}
        onEdit={handleEditFromPopover}
        onOpenDailyNote={onOpenDailyNoteFromCalendar ? handleOpenDailyNoteFromPopover : undefined}
        onDismiss={handleDismissPopover}
      />
    </div>
  );
}
