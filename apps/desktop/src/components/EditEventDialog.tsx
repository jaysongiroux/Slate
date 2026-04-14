import { useEffect, useState } from "react";
import type { CalendarAttendeeInput, CalendarEvent } from "@slate/shared";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input, nativeFieldBorderedClassName } from "./ui/input";
import { AttendeePicker } from "./calendar/AttendeePicker";

interface EditEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | null;
  onConfirm: (data: {
    subscriptionId: string;
    eventId: string;
    title?: string;
    description?: string;
    location?: string;
    startTime?: string;
    endTime?: string;
    allDay?: boolean;
    attendees?: CalendarAttendeeInput[];
  }) => Promise<void> | void;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toLocalDateTimeString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseEventDate(s: string): Date {
  return s.includes("T") ? new Date(s) : new Date(`${s}T00:00:00`);
}

function normalizeAttendees(attendees: CalendarAttendeeInput[]): string[] {
  return attendees
    .map((attendee) => `${attendee.email.trim().toLowerCase()}::${attendee.displayName?.trim() ?? ""}`)
    .sort();
}

export function EditEventDialog({ open, onOpenChange, event, onConfirm }: EditEventDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [attendees, setAttendees] = useState<CalendarAttendeeInput[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !event) return;
    setTitle(event.title);
    setDescription(event.description ?? "");
    setLocation(event.location ?? "");
    setAllDay(event.allDay);
    const start = parseEventDate(event.startTime);
    const end = parseEventDate(event.endTime);
    setStartTime(toLocalDateTimeString(start));
    setEndTime(toLocalDateTimeString(end));
    setStartDate(toLocalDateString(start));
    setEndDate(toLocalDateString(end));
    setAttendees(
      (event.attendees ?? []).map((attendee) => ({
        email: attendee.email,
        displayName: attendee.displayName,
      })),
    );
    setSubmitting(false);
  }, [open, event]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!event || !title.trim() || submitting) return;

    const initialAttendees = (event.attendees ?? []).map((attendee) => ({
      email: attendee.email,
      displayName: attendee.displayName,
    }));
    const attendeesChanged =
      JSON.stringify(normalizeAttendees(attendees)) !==
      JSON.stringify(normalizeAttendees(initialAttendees));

    setSubmitting(true);
    try {
      await onConfirm({
        subscriptionId: event.subscriptionId!,
        eventId: event.id,
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        startTime: allDay ? `${startDate}T00:00:00` : new Date(startTime).toISOString(),
        endTime: allDay ? `${endDate}T23:59:59` : new Date(endTime).toISOString(),
        allDay,
        attendees: attendeesChanged ? attendees : undefined,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(460px,calc(100vw-32px))]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader className="mb-0">
            <DialogTitle>Edit Event</DialogTitle>
          </DialogHeader>

          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title"
            autoFocus
            variant="bordered"
            className="text-[0.95rem]"
          />

          <div className="flex items-center gap-2">
            <input
              id="edit-event-all-day"
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="accent-[rgba(124,92,220,0.8)]"
            />
            <label
              htmlFor="edit-event-all-day"
              className="cursor-pointer text-[0.82rem] text-muted"
            >
              All day
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.8rem] text-muted" htmlFor="edit-event-start">
                Start
              </label>
              {allDay ? (
                <input
                  id="edit-event-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={nativeFieldBorderedClassName}
                />
              ) : (
                <input
                  id="edit-event-start"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={nativeFieldBorderedClassName}
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[0.8rem] text-muted" htmlFor="edit-event-end">
                End
              </label>
              {allDay ? (
                <input
                  id="edit-event-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={nativeFieldBorderedClassName}
                />
              ) : (
                <input
                  id="edit-event-end"
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={nativeFieldBorderedClassName}
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <AttendeePicker
              value={attendees}
              onChange={setAttendees}
              subscriptionId={event?.subscriptionId}
              provider={event?.source}
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[0.8rem] text-muted" htmlFor="edit-event-location">
              Location
            </label>
            <Input
              id="edit-event-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Optional"
              variant="bordered"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[0.8rem] text-muted" htmlFor="edit-event-description">
              Description
            </label>
            <textarea
              id="edit-event-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              rows={3}
              className={`${nativeFieldBorderedClassName} resize-none`}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="dialog-secondary"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button variant="dialog-primary" type="submit" disabled={!title.trim() || submitting}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
