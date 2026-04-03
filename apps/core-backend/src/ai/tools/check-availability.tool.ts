import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Logger } from "@nestjs/common";
import type { CalendarService } from "../../calendar/calendar.service";
import type { IcsService } from "../../calendar/ics.service";

export function createCheckAvailabilityTool(
  calendarService: CalendarService,
  icsService: IcsService,
  userId: string,
  enabledCalendarIds: string[],
  enabledIcsIds: string[],
  logger: Logger,
) {
  return (tool as any)(
    async (input: { startDate: string; endDate: string }) => {
      const [calEvents, icsEvents] = await Promise.all([
        calendarService.fetchEvents(userId, input.startDate, input.endDate),
        icsService.fetchEvents(userId, input.startDate, input.endDate),
      ]);

      const enabledSet = new Set([...enabledCalendarIds, ...enabledIcsIds]);

      // Collect busy intervals from enabled calendars
      const busyIntervals = [...calEvents, ...icsEvents]
        .filter((e) => e.subscriptionId && enabledSet.has(e.subscriptionId))
        .map((e) => ({
          start: new Date(e.startTime).getTime(),
          end: new Date(e.endTime).getTime(),
          title: e.title,
        }))
        .sort((a, b) => a.start - b.start);

      // Merge overlapping intervals
      const merged: { start: number; end: number; title: string }[] = [];
      for (const interval of busyIntervals) {
        const last = merged[merged.length - 1];
        if (last && interval.start <= last.end) {
          last.end = Math.max(last.end, interval.end);
        } else {
          merged.push({ ...interval });
        }
      }

      const rangeStart = new Date(input.startDate).getTime();
      const rangeEnd = new Date(input.endDate).getTime();

      // Compute free slots as gaps
      const freeSlots: { start: string; end: string }[] = [];
      let cursor = rangeStart;
      for (const slot of merged) {
        if (slot.start > cursor) {
          freeSlots.push({
            start: new Date(cursor).toISOString(),
            end: new Date(slot.start).toISOString(),
          });
        }
        cursor = Math.max(cursor, slot.end);
      }
      if (cursor < rangeEnd) {
        freeSlots.push({
          start: new Date(cursor).toISOString(),
          end: new Date(rangeEnd).toISOString(),
        });
      }

      const busySlots = merged.map((s) => ({
        start: new Date(s.start).toISOString(),
        end: new Date(s.end).toISOString(),
        title: s.title,
      }));

      logger.log(
        `[calendar-tool] check_availability userId=${userId} range=${input.startDate}..${input.endDate} busySlots=${busySlots.length} freeSlots=${freeSlots.length}`,
      );

      return JSON.stringify({ busySlots, freeSlots });
    },
    {
      name: "check_availability",
      description:
        "Checks free/busy availability across all AI-enabled calendars in a time range. Returns busy slots (with titles) and free slots (gaps between busy periods). Use this when the user asks about availability, free time, or scheduling.",
      schema: z.object({
        startDate: z.string().describe("Start of time range (ISO 8601 datetime)"),
        endDate: z.string().describe("End of time range (ISO 8601 datetime)"),
      }),
    },
  );
}
