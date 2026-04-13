import { tool } from "@langchain/core/tools";
import { z } from "zod";
interface Logger {
  log(message: string): void;
  warn(message: string): void;
}
import type { CalendarService } from "../../calendar/calendar.service";

export function createCreateCalendarEventTool(
  calendarService: CalendarService,
  userId: string,
  enabledCalendarIds: string[],
  enabledIcsIds: string[],
  logger: Logger,
) {
  return (tool as any)(
    async (input: {
      subscriptionId: string;
      title: string;
      startTime: string;
      endTime: string;
      description: string | null;
      location: string | null;
      allDay: boolean;
    }) => {
      if (!enabledCalendarIds.includes(input.subscriptionId)) {
        if (enabledIcsIds.includes(input.subscriptionId)) {
          return "This is a read-only ICS feed. Events cannot be created, modified, or deleted.";
        }
        return "This calendar is not enabled for AI access.";
      }

      try {
        const event = await calendarService.createEvent(userId, input.subscriptionId, {
          title: input.title,
          startTime: input.startTime,
          endTime: input.endTime,
          description: input.description ?? undefined,
          location: input.location ?? undefined,
          allDay: input.allDay,
        });
        logger.log(
          `[calendar-tool] create_calendar_event userId=${userId} subscriptionId=${input.subscriptionId} eventId=${event.id} title="${event.title}"`,
        );
        return `Created event: ${event.title} (id: ${event.id}) on ${(event as any).calendarName}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `[calendar-tool] create_calendar_event ERROR userId=${userId} subscriptionId=${input.subscriptionId} error="${msg}"`,
        );
        return `Calendar API error: ${msg}`;
      }
    },
    {
      name: "create_calendar_event",
      description:
        "Creates a new calendar event. First call list_calendars to find the subscription ID for the target calendar by name. Requires subscription ID, title, start time, and end time. Cannot create events on read-only ICS feeds.",
      schema: z.object({
        subscriptionId: z
          .string()
          .describe(
            "The calendar subscription ID (from list_calendars, NOT the calendar name or email)",
          ),
        title: z.string().describe("Event title"),
        startTime: z.string().describe("Event start time (ISO 8601 datetime)"),
        endTime: z.string().describe("Event end time (ISO 8601 datetime)"),
        description: z.string().nullable().describe("Event description or notes"),
        location: z.string().nullable().describe("Event location"),
        allDay: z.boolean().describe("Whether this is an all-day event"),
      }),
    },
  );
}
