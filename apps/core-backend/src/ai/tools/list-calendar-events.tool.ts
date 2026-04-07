import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Logger } from "@nestjs/common";
import type { CalendarService } from "../../calendar/calendar.service";
import type { IcsService } from "../../calendar/ics.service";

const MAX_RESULTS = 50;

export function createListCalendarEventsTool(
  calendarService: CalendarService,
  icsService: IcsService,
  userId: string,
  enabledCalendarIds: string[],
  enabledIcsIds: string[],
  logger: Logger,
) {
  return (tool as any)(
    async (input: {
      startDate: string;
      endDate: string;
      query: string | null;
      calendarId: string | null;
      rsvpStatus: string | null;
      allDay: boolean | null;
    }) => {
      // If calendarId filter is specified, validate it's in the enabled set
      if (
        input.calendarId &&
        !enabledCalendarIds.includes(input.calendarId) &&
        !enabledIcsIds.includes(input.calendarId)
      ) {
        return "This calendar is not enabled for AI access.";
      }

      const [calEvents, icsEvents] = await Promise.all([
        calendarService.fetchEvents(userId, input.startDate, input.endDate),
        icsService.fetchEvents(userId, input.startDate, input.endDate),
      ]);

      const enabledSet = new Set([...enabledCalendarIds, ...enabledIcsIds]);

      let events = [...calEvents, ...icsEvents].filter(
        (e) => e.subscriptionId && enabledSet.has(e.subscriptionId),
      );

      // Apply filters
      if (input.calendarId) {
        events = events.filter((e) => e.subscriptionId === input.calendarId);
      }

      if (input.query) {
        const q = input.query.toLowerCase();
        events = events.filter(
          (e) =>
            e.title.toLowerCase().includes(q) ||
            (e.description && e.description.toLowerCase().includes(q)),
        );
      }

      if (input.rsvpStatus) {
        events = events.filter((e) => {
          const attendees = (e as any).attendees;
          const selfAttendee = attendees?.find((a: any) => a.self);
          return selfAttendee?.responseStatus === input.rsvpStatus;
        });
      }

      if (input.allDay !== null) {
        events = events.filter((e) => e.allDay === input.allDay);
      }

      // Sort chronologically and cap
      events.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      events = events.slice(0, MAX_RESULTS);

      // Shape output (lightweight — no full description or attendee list)
      const output = events.map((e) => ({
        id: e.id,
        subscriptionId: e.subscriptionId,
        calendarName: (e as any).calendarName,
        title: e.title,
        startTime: e.startTime,
        endTime: e.endTime,
        allDay: e.allDay,
        location: (e as any).location,
        conferenceLink: (e as any).conferenceLink,
        attendeeCount: (e as any).attendees?.length ?? 0,
        rsvpStatus: (e as any).attendees?.find((a: any) => a.self)?.responseStatus ?? null,
      }));

      const filters = [
        input.query && `query="${input.query}"`,
        input.calendarId && `calendarId=${input.calendarId}`,
        input.rsvpStatus && `rsvp=${input.rsvpStatus}`,
        input.allDay !== null && `allDay=${input.allDay}`,
      ]
        .filter(Boolean)
        .join(" ");
      logger.log(
        `[calendar-tool] list_calendar_events userId=${userId} range=${input.startDate}..${input.endDate} ${filters ? filters + " " : ""}fetched=${calEvents.length + icsEvents.length} returned=${output.length}`,
      );

      return JSON.stringify(output);
    },
    {
      name: "list_calendar_events",
      description:
        "Lists calendar events within a time range. Supports filtering by calendar, text query, RSVP status, and all-day events. Returns up to 50 results sorted chronologically. Use get_calendar_event for full details on a specific event.",
      schema: z.object({
        startDate: z.string().describe("Start of time range (ISO 8601 datetime)"),
        endDate: z.string().describe("End of time range (ISO 8601 datetime)"),
        query: z.string().nullable().describe("Filter by title/description substring match"),
        calendarId: z.string().nullable().describe("Scope to a single calendar subscription ID"),
        rsvpStatus: z
          .enum(["accepted", "tentative", "declined", "needsAction"])
          .nullable()
          .describe("Filter by user's RSVP status"),
        allDay: z
          .boolean()
          .nullable()
          .describe("Filter to only all-day (true) or only timed (false) events"),
      }),
    },
  );
}
