import { createGetCalendarEventTool } from "./get-calendar-event.tool";

const userId = "user-1";
const enabledCalendarIds = ["sub-1"];
const enabledIcsIds = ["ics-1"];

function makeMockCalendarService(events: unknown[] = []) {
  return {
    fetchEvents: jest.fn().mockResolvedValue(events),
  } as any;
}

function makeMockIcsService(events: unknown[] = []) {
  return {
    fetchEvents: jest.fn().mockResolvedValue(events),
  } as any;
}

function makeMockLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
}

describe("createGetCalendarEventTool", () => {
  it("returns a tool with name 'get_calendar_event'", () => {
    const t = createGetCalendarEventTool(makeMockCalendarService(), makeMockIcsService(), userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());
    expect(t.name).toBe("get_calendar_event");
  });

  it("rejects when subscriptionId is not in enabled set", async () => {
    const t = createGetCalendarEventTool(makeMockCalendarService(), makeMockIcsService(), userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());
    const result = await t.invoke({ subscriptionId: "sub-99", eventId: "e1" });
    expect(result).toContain("not enabled for AI access");
  });

  it("returns full event details when found in calendar events", async () => {
    const event = {
      id: "e1",
      subscriptionId: "sub-1",
      calendarName: "Work",
      title: "Standup",
      description: "Daily sync",
      startTime: "2026-04-01T09:00:00Z",
      endTime: "2026-04-01T09:30:00Z",
      allDay: false,
      location: "Room 4B",
      htmlLink: "https://calendar.google.com/event/e1",
      conferenceLink: "https://meet.google.com/abc",
      conferenceName: "Google Meet",
      readOnly: false,
      attendees: [{ email: "alice@test.com", displayName: "Alice", responseStatus: "accepted", self: true }],
    };
    const calService = makeMockCalendarService([event]);
    const t = createGetCalendarEventTool(calService, makeMockIcsService(), userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());

    const result = await t.invoke({ subscriptionId: "sub-1", eventId: "e1" });
    const parsed = JSON.parse(result as string);

    expect(parsed.id).toBe("e1");
    expect(parsed.description).toBe("Daily sync");
    expect(parsed.attendees).toHaveLength(1);
    expect(parsed.conferenceLink).toBe("https://meet.google.com/abc");
  });

  it("returns event not found when eventId doesn't match", async () => {
    const calService = makeMockCalendarService([
      { id: "e1", subscriptionId: "sub-1", title: "Other", startTime: "2026-04-01T09:00:00Z", endTime: "2026-04-01T10:00:00Z" },
    ]);
    const t = createGetCalendarEventTool(calService, makeMockIcsService(), userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());

    const result = await t.invoke({ subscriptionId: "sub-1", eventId: "nonexistent" });
    expect(result).toContain("Event not found");
  });

  it("searches ICS events when subscriptionId is an ICS id", async () => {
    const icsEvent = {
      id: "ics-evt-1",
      subscriptionId: "ics-1",
      calendarName: "Holidays",
      title: "Holiday",
      startTime: "2026-04-01T00:00:00Z",
      endTime: "2026-04-02T00:00:00Z",
      allDay: true,
      readOnly: true,
    };
    const icsService = makeMockIcsService([icsEvent]);
    const t = createGetCalendarEventTool(makeMockCalendarService(), icsService, userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());

    const result = await t.invoke({ subscriptionId: "ics-1", eventId: "ics-evt-1" });
    const parsed = JSON.parse(result as string);

    expect(parsed.id).toBe("ics-evt-1");
    expect(parsed.title).toBe("Holiday");
  });
});
