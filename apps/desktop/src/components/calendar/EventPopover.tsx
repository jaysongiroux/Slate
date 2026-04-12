import { Loader2 } from "lucide-react";
import DOMPurify from "dompurify";
import { cn } from "../../lib/utils";
import { AttendeeList, displayEventTitle, type BigCalendarEvent } from "./CalendarHelpers";
import { SLATE_DAILY_NOTE_SOURCE } from "../../lib/calendar-daily-notes";

interface EventPopoverProps {
  event: BigCalendarEvent | null;
  popoverPosition: { left: number; top: number } | null;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  timing: string;
  calendarName: string;
  rsvpLoading: string | null;
  onRsvp: (status: "accepted" | "tentative" | "declined") => void;
  onEdit: () => void;
  onOpenDailyNote?: () => void;
  onDismiss: () => void;
}

export function EventPopover({
  event,
  popoverPosition,
  popoverRef,
  timing,
  calendarName,
  rsvpLoading,
  onRsvp,
  onEdit,
  onOpenDailyNote,
  onDismiss,
}: EventPopoverProps) {
  if (!event) return null;

  return (
    <div
      ref={popoverRef}
      className="calendar-view__event-popover bg-panel-elevated overflow-y-auto overflow-x-hidden p-3"
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
            backgroundColor: event.resource.color || "rgba(124, 92, 220, 0.88)",
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="break-words text-[0.88rem] font-semibold leading-[1.25] text-foreground">
            {displayEventTitle(event.title)}
          </div>
          <div className="mt-1 break-words text-[0.74rem] leading-[1.35] text-muted-foreground">
            {timing}
          </div>
        </div>
      </div>
      {event.resource.location ? (
        <div className="mt-3 border-t border-border pt-3">
          <div className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint">
            Location
          </div>
          <div className="break-words text-[0.78rem] leading-[1.45] text-muted-foreground">
            {event.resource.location.startsWith("https://") ? (
              <a
                href={event.resource.location}
                className="text-muted-foreground underline hover:brightness-110"
                target="_blank"
                rel="noreferrer"
              >
                {event.resource.location}
              </a>
            ) : (
              event.resource.location
            )}
          </div>
        </div>
      ) : null}
      {event.resource.conferenceLink ? (
        <div className="mt-3 border-t border-border pt-3">
          <a
            href={event.resource.conferenceLink}
            className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[0.78rem] text-muted-foreground transition-colors hover:bg-white/[0.1] hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            Join {event.resource.conferenceName || "Meeting"}
          </a>
        </div>
      ) : null}
      {!event.resource.readOnly &&
      event.resource.subscriptionId &&
      event.resource.attendees?.some((a) => a.self) ? (
        <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-3">
          <span className="mr-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint">
            RSVP
          </span>
          {(["accepted", "tentative", "declined"] as const).map((status) => {
            const selfAttendee = event.resource.attendees?.find((a) => a.self);
            const isActive = selfAttendee?.responseStatus === status;
            const isLoading = rsvpLoading === status;
            const label = status === "accepted" ? "Yes" : status === "tentative" ? "Maybe" : "No";
            return (
              <button
                key={status}
                type="button"
                disabled={rsvpLoading !== null}
                className={cn(
                  "cursor-pointer rounded-md border px-2 py-0.5 text-[0.72rem] font-medium transition-colors",
                  isActive
                    ? "border-white/20 bg-white/[0.1] text-foreground"
                    : "border-transparent bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08]",
                  rsvpLoading !== null && "opacity-50 cursor-not-allowed",
                )}
                onClick={() => onRsvp(status)}
              >
                {isLoading ? <Loader2 size={10} className="inline animate-spin" /> : label}
              </button>
            );
          })}
        </div>
      ) : null}
      {event.resource.description ? (
        <div className="mt-3 border-t border-border pt-3">
          <div className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint">
            Details
          </div>
          <div
            className="calendar-event-description break-words text-[0.78rem] leading-[1.45] text-muted-foreground [&_a]:text-muted-foreground [&_a]:underline"
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(event.resource.description, {
                ALLOWED_TAGS: ["a", "b", "i", "em", "strong", "br", "p", "ul", "ol", "li", "span"],
                ALLOWED_ATTR: ["href", "target", "rel"],
              }),
            }}
          />
        </div>
      ) : null}
      {event.resource.attendees && event.resource.attendees.length > 0 ? (
        <AttendeeList attendees={event.resource.attendees} />
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-2 text-[0.70rem] tracking-[0.08em] text-muted">
        <span>{calendarName}</span>
        {event.resource.source === SLATE_DAILY_NOTE_SOURCE && onOpenDailyNote ? (
          <button
            type="button"
            className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
            onClick={onOpenDailyNote}
          >
            Open note
          </button>
        ) : !event.resource.readOnly && event.resource.subscriptionId ? (
          <button
            type="button"
            className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
            onClick={onEdit}
          >
            Edit
          </button>
        ) : null}
      </div>
    </div>
  );
}
