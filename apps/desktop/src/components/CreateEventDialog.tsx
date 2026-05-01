import { useEffect, useMemo, useState } from "react";
import type { CalendarAttendeeInput, CalendarInfo } from "@slate/shared";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input, nativeFieldBorderedClassName } from "./ui/input";
import { Select } from "./ui/select";
import { Checkbox } from "./ui/checkbox";
import { AttendeePicker } from "./calendar/AttendeePicker";

interface CreateEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendars: CalendarInfo[];
  initialStart?: Date;
  initialEnd?: Date;
  initialAllDay?: boolean;
  onConfirm: (data: {
    subscriptionId: string;
    title: string;
    description: string;
    location: string;
    startTime: string;
    endTime: string;
    allDay: boolean;
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

export function CreateEventDialog({
  open,
  onOpenChange,
  calendars,
  initialStart,
  initialEnd,
  initialAllDay,
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
  const [attendees, setAttendees] = useState<CalendarAttendeeInput[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const selectedCalendarInfo = useMemo(
    () => writableCalendars.find((calendar) => calendar.subscriptionId === selectedCalendar),
    [selectedCalendar, writableCalendars],
  );

  useEffect(() => {
    if (!open) return;
    const start = initialStart ?? new Date();
    const end = initialEnd ?? new Date(start.getTime() + 60 * 60 * 1000);
    const isAllDay = initialAllDay ?? false;
    setTitle("");
    setDescription("");
    setLocation("");
    setAllDay(isAllDay);
    setStartTime(toLocalDateTimeString(start));
    setEndTime(toLocalDateTimeString(end));
    setStartDate(toLocalDateString(start));
    setEndDate(toLocalDateString(end));
    setAttendees([]);
    setSubmitting(false);
  }, [open, initialStart, initialEnd, initialAllDay]);

  useEffect(() => {
    if (!open) return;
    if (!writableCalendars.some((calendar) => calendar.subscriptionId === selectedCalendar)) {
      setSelectedCalendar(writableCalendars[0]?.subscriptionId ?? "");
    }
  }, [open, writableCalendars, selectedCalendar]);

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
        attendees: attendees.length > 0 ? attendees : undefined,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <DialogHeader className="mb-0">
            <DialogTitle>New Event</DialogTitle>
          </DialogHeader>

          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Event title"
            autoFocus
            variant="bordered"
          />

          <div className="flex flex-col gap-1">
            <label className="text-[0.8rem] text-muted" htmlFor="event-calendar">
              Calendar
            </label>
            <Select
              id="event-calendar"
              value={selectedCalendar}
              onChange={(event) => setSelectedCalendar(event.target.value)}
              className={nativeFieldBorderedClassName}
            >
              {writableCalendars.map((calendar) => (
                <option key={calendar.subscriptionId} value={calendar.subscriptionId}>
                  {calendar.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="event-all-day"
              className="accent-[rgba(124,92,220,0.8)]"
              checked={allDay}
              onCheckedChange={(checked) => setAllDay(checked === true)}
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
                  className={nativeFieldBorderedClassName}
                />
              ) : (
                <input
                  id="event-start"
                  type="datetime-local"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  className={nativeFieldBorderedClassName}
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
                  className={nativeFieldBorderedClassName}
                />
              ) : (
                <input
                  id="event-end"
                  type="datetime-local"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  className={nativeFieldBorderedClassName}
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <AttendeePicker
              value={attendees}
              onChange={setAttendees}
              subscriptionId={selectedCalendarInfo?.subscriptionId}
              provider={selectedCalendarInfo?.provider}
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[0.8rem] text-muted" htmlFor="event-location">
              Location
            </label>
            <Input
              id="event-location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Optional"
              variant="bordered"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[0.8rem] text-muted" htmlFor="event-description">
              Description
            </label>
            <textarea
              id="event-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional"
              rows={2}
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
            <Button
              variant="dialog-primary"
              type="submit"
              disabled={!title.trim() || !selectedCalendar || submitting}
            >
              {submitting ? "Creating…" : "Create event"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
