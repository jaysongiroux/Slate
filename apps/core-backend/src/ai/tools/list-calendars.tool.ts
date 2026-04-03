import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Logger } from "@nestjs/common";
import type { CalendarService } from "../../calendar/calendar.service";

export function createListCalendarsTool(
  calendarService: CalendarService,
  userId: string,
  enabledCalendarIds: string[],
  enabledIcsIds: string[],
  logger: Logger,
) {
  return (tool as any)(
    async (_input: Record<string, never>) => {
      const status = await calendarService.getStatus(userId);

      const enabledCalSet = new Set(enabledCalendarIds);
      const enabledIcsSet = new Set(enabledIcsIds);

      const calendars = status.connections.flatMap((conn: any) =>
        conn.calendars
          .filter((cal: any) => enabledCalSet.has(cal.subscriptionId))
          .map((cal: any) => ({
            subscriptionId: cal.subscriptionId,
            name: cal.name,
            source: conn.provider,
            email: conn.email,
            readOnly: false,
          })),
      );

      const icsCalendars = status.icsSubscriptions
        .filter((s: any) => enabledIcsSet.has(s.id))
        .map((s: any) => ({
          subscriptionId: s.id,
          name: s.name,
          source: "ics",
          email: null,
          readOnly: true,
        }));

      const all = [...calendars, ...icsCalendars];

      logger.log(
        `[calendar-tool] list_calendars userId=${userId} returned=${all.length} (cal=${calendars.length} ics=${icsCalendars.length})`,
      );

      return JSON.stringify(all);
    },
    {
      name: "list_calendars",
      description:
        "Lists the user's calendars that are available for AI access. Returns calendar names, subscription IDs, source (google, ics), and whether they are read-only. Use this to find which calendar to target when creating events or to understand the user's calendar setup.",
      schema: z.object({}),
    },
  );
}
