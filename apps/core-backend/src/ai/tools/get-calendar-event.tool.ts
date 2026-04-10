import { tool } from "@langchain/core/tools";
import { z } from "zod";
interface Logger {
  log(message: string): void;
  warn(message: string): void;
}
import type { CalendarService } from "../../calendar/calendar.service";
import type { IcsService } from "../../calendar/ics.service";

const SEARCH_WINDOW_DAYS = 180;

export function createGetCalendarEventTool(
  calendarService: CalendarService,
  icsService: IcsService,
  userId: string,
  enabledCalendarIds: string[],
  enabledIcsIds: string[],
  logger: Logger,
) {
  return (tool as any)(
    async (input: { subscriptionId: string; eventId: string }) => {
      const enabledSet = new Set([...enabledCalendarIds, ...enabledIcsIds]);
      if (!enabledSet.has(input.subscriptionId)) {
        return "This calendar is not enabled for AI access.";
      }

      const now = new Date();
      const timeMin = new Date(
        now.getTime() - SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const timeMax = new Date(
        now.getTime() + SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

      const isIcs = enabledIcsIds.includes(input.subscriptionId);
      const events = isIcs
        ? await icsService.fetchEvents(userId, timeMin, timeMax)
        : await calendarService.fetchEvents(userId, timeMin, timeMax);

      const event = events.find(
        (e: any) => e.id === input.eventId && e.subscriptionId === input.subscriptionId,
      );

      if (!event) {
        logger.log(
          `[calendar-tool] get_calendar_event userId=${userId} subscriptionId=${input.subscriptionId} eventId=${input.eventId} found=false`,
        );
        return "Event not found.";
      }

      logger.log(
        `[calendar-tool] get_calendar_event userId=${userId} subscriptionId=${input.subscriptionId} eventId=${input.eventId} found=true title="${event.title}"`,
      );

      return JSON.stringify({
        id: event.id,
        subscriptionId: event.subscriptionId,
        calendarName: (event as any).calendarName,
        title: event.title,
        description: (event as any).description ?? null,
        startTime: event.startTime,
        endTime: event.endTime,
        allDay: event.allDay,
        location: (event as any).location ?? null,
        htmlLink: (event as any).htmlLink ?? null,
        conferenceLink: (event as any).conferenceLink ?? null,
        conferenceName: (event as any).conferenceName ?? null,
        readOnly: (event as any).readOnly ?? false,
        attendees: (event as any).attendees ?? [],
      });
    },
    {
      name: "get_calendar_event",
      description:
        "Retrieves full details of a specific calendar event, including description, attendees, conference links, and RSVP statuses. Use after list_calendar_events to get more information about a specific event.",
      schema: z.object({
        subscriptionId: z.string().describe("The calendar subscription ID the event belongs to"),
        eventId: z.string().describe("The event ID to retrieve"),
      }),
    },
  );
}
