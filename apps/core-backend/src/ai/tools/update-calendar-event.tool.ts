import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Logger } from "@nestjs/common";
import type { CalendarService } from "../../calendar/calendar.service";

export function createUpdateCalendarEventTool(
  calendarService: CalendarService,
  userId: string,
  enabledCalendarIds: string[],
  enabledIcsIds: string[],
  logger: Logger,
) {
  return (tool as any)(
    async (input: {
      subscriptionId: string;
      eventId: string;
      title: string | null;
      startTime: string | null;
      endTime: string | null;
      description: string | null;
      location: string | null;
      allDay: boolean | null;
    }) => {
      if (!enabledCalendarIds.includes(input.subscriptionId)) {
        if (enabledIcsIds.includes(input.subscriptionId)) {
          return "This is a read-only ICS feed. Events cannot be created, modified, or deleted.";
        }
        return "This calendar is not enabled for AI access.";
      }

      const data: Record<string, unknown> = {};
      if (input.title !== null) data.title = input.title;
      if (input.startTime !== null) data.startTime = input.startTime;
      if (input.endTime !== null) data.endTime = input.endTime;
      if (input.description !== null) data.description = input.description;
      if (input.location !== null) data.location = input.location;
      if (input.allDay !== null) data.allDay = input.allDay;

      try {
        const event = await calendarService.updateEvent(userId, input.subscriptionId, input.eventId, data);
        logger.log(
          `[calendar-tool] update_calendar_event userId=${userId} subscriptionId=${input.subscriptionId} eventId=${input.eventId} fields=${Object.keys(data).join(",")}`,
        );
        return `Updated event: ${event.title} (id: ${event.id})`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `[calendar-tool] update_calendar_event ERROR userId=${userId} subscriptionId=${input.subscriptionId} eventId=${input.eventId} error="${msg}"`,
        );
        return `Calendar API error: ${msg}`;
      }
    },
    {
      name: "update_calendar_event",
      description:
        "Updates an existing calendar event. Use list_calendars to find the subscription ID by calendar name. Only provide the fields you want to change — omitted fields remain unchanged. Cannot modify events on read-only ICS feeds.",
      schema: z.object({
        subscriptionId: z.string().describe("The calendar subscription ID (from list_calendars, NOT the calendar name or email)"),
        eventId: z.string().describe("The event ID to update"),
        title: z.string().nullable().describe("New event title"),
        startTime: z.string().nullable().describe("New start time (ISO 8601 datetime)"),
        endTime: z.string().nullable().describe("New end time (ISO 8601 datetime)"),
        description: z.string().nullable().describe("New event description"),
        location: z.string().nullable().describe("New event location"),
        allDay: z.boolean().nullable().describe("Change all-day status"),
      }),
    },
  );
}
