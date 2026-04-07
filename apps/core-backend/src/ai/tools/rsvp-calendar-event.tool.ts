import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Logger } from "@nestjs/common";
import type { CalendarService } from "../../calendar/calendar.service";

export function createRsvpCalendarEventTool(
  calendarService: CalendarService,
  userId: string,
  enabledCalendarIds: string[],
  enabledIcsIds: string[],
  logger: Logger,
) {
  return (tool as any)(
    async (input: { subscriptionId: string; eventId: string; response: string }) => {
      if (!enabledCalendarIds.includes(input.subscriptionId)) {
        if (enabledIcsIds.includes(input.subscriptionId)) {
          return "This is a read-only ICS feed. Events cannot be created, modified, or deleted.";
        }
        return "This calendar is not enabled for AI access.";
      }

      try {
        await calendarService.rsvpEvent(
          userId,
          input.subscriptionId,
          input.eventId,
          input.response,
        );
        logger.log(
          `[calendar-tool] rsvp_calendar_event userId=${userId} subscriptionId=${input.subscriptionId} eventId=${input.eventId} response=${input.response}`,
        );
        return `RSVP'd ${input.response} to event (id: ${input.eventId})`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `[calendar-tool] rsvp_calendar_event ERROR userId=${userId} subscriptionId=${input.subscriptionId} eventId=${input.eventId} error="${msg}"`,
        );
        return `Calendar API error: ${msg}`;
      }
    },
    {
      name: "rsvp_calendar_event",
      description:
        "Responds to a calendar event invitation with accepted, tentative, or declined. Use list_calendars to find the subscription ID by calendar name. Cannot RSVP to events on read-only ICS feeds.",
      schema: z.object({
        subscriptionId: z
          .string()
          .describe(
            "The calendar subscription ID (from list_calendars, NOT the calendar name or email)",
          ),
        eventId: z.string().describe("The event ID to RSVP to"),
        response: z.enum(["accepted", "tentative", "declined"]).describe("RSVP response"),
      }),
    },
  );
}
