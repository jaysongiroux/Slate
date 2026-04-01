import { useEffect, useMemo, useState } from "react";
import type { CalendarInfo } from "@slate/shared";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

interface CreateEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendars: CalendarInfo[];
  onConfirm: (data: {
    subscriptionId: string;
    title: string;
    description: string;
    location: string;
    startTime: string;
    endTime: string;
    allDay: boolean;
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

export function CreateEventDialog({
  open,
  onOpenChange,
  calendars,
  onConfirm,
}: CreateEventDialogProps) {
  const writableCalendars = useMemo(
    () => calendars.filter((calendar) => calendar.enabled),
    [calendars],
  );
  const now = useMemo(() => new Date(), [open]);
  const oneHourLater = useMemo(() => new Date(now.getTime() + 60 * 60 * 1000), [now]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState(toLocalDateTimeString(now));
  const [endTime, setEndTime] = useState(toLocalDateTimeString(oneHourLater));
  const [startDate, setStartDate] = useState(toLocalDateString(now));
  const [endDate, setEndDate] = useState(toLocalDateString(now));
  const [selectedCalendar, setSelectedCalendar] = useState(
    writableCalendars[0]?.subscriptionId ?? "",
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextNow = new Date();
    const nextHour = new Date(nextNow.getTime() + 60 * 60 * 1000);
    setTitle("");
    setDescription("");
    setLocation("");
    setAllDay(false);
    setStartTime(toLocalDateTimeString(nextNow));
    setEndTime(toLocalDateTimeString(nextHour));
    setStartDate(toLocalDateString(nextNow));
    setEndDate(toLocalDateString(nextNow));
    setSelectedCalendar(writableCalendars[0]?.subscriptionId ?? "");
    setSubmitting(false);
  }, [open, writableCalendars]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !selectedCalendar || submitting) return;

    setSubmitting(true);
    try {
      await onConfirm({
        subscriptionId: selectedCalendar,
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        startTime: allDay ? `${startDate}T00:00:00` : new Date(startTime).toISOString(),
        endTime: allDay ? `${endDate}T23:59:59` : new Date(endTime).toISOString(),
        allDay,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader className="mb-0">
            <DialogTitle>New Event</DialogTitle>
            <DialogDescription>Create an event on one of your enabled calendars.</DialogDescription>
          </DialogHeader>

          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Event title"
            autoFocus
            className="text-[0.95rem]"
          />

          <div className="flex flex-col gap-2">
            <label className="text-[0.8rem] text-muted" htmlFor="event-calendar">
              Calendar
            </label>
            <select
              id="event-calendar"
              value={selectedCalendar}
              onChange={(event) => setSelectedCalendar(event.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[0.85rem] text-foreground outline-none focus:border-white/[0.16]"
            >
              {writableCalendars.map((calendar) => (
                <option key={calendar.subscriptionId} value={calendar.subscriptionId}>
                  {calendar.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="event-all-day"
              type="checkbox"
              checked={allDay}
              onChange={(event) => setAllDay(event.target.checked)}
              className="accent-[rgba(124,92,220,0.8)]"
            />
            <label htmlFor="event-all-day" className="cursor-pointer text-[0.82rem] text-muted">
              All day
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.8rem] text-muted" htmlFor="event-start">
                Start
              </label>
              {allDay ? (
                <input
                  id="event-start"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[0.85rem] text-foreground outline-none"
                />
              ) : (
                <input
                  id="event-start"
                  type="datetime-local"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[0.85rem] text-foreground outline-none"
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[0.8rem] text-muted" htmlFor="event-end">
                End
              </label>
              {allDay ? (
                <input
                  id="event-end"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[0.85rem] text-foreground outline-none"
                />
              ) : (
                <input
                  id="event-end"
                  type="datetime-local"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[0.85rem] text-foreground outline-none"
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[0.8rem] text-muted" htmlFor="event-location">
              Location
            </label>
            <Input
              id="event-location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[0.8rem] text-muted" htmlFor="event-description">
              Description
            </label>
            <textarea
              id="event-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional"
              rows={3}
              className="resize-none rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-2 text-[0.85rem] text-foreground outline-none focus:border-white/[0.16]"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || !selectedCalendar || submitting}>
              {submitting ? "Creating…" : "Create event"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
