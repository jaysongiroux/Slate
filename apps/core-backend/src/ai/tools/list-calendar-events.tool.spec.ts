import { createListCalendarEventsTool } from "./list-calendar-events.tool";

const userId = "user-1";

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

const enabledCalendarIds = ["sub-1", "sub-2"];
const enabledIcsIds = ["ics-1"];

describe("createListCalendarEventsTool", () => {
  it("returns a tool with name 'list_calendar_events'", () => {
    const t = createListCalendarEventsTool(
      makeMockCalendarService(),
      makeMockIcsService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );
    expect(t.name).toBe("list_calendar_events");
  });

  it("calls CalendarService.fetchEvents and IcsService.fetchEvents with date range", async () => {
    const calService = makeMockCalendarService();
    const icsService = makeMockIcsService();
    const t = createListCalendarEventsTool(
      calService,
      icsService,
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    await t.invoke({
      startDate: "2026-04-01T00:00:00Z",
      endDate: "2026-04-02T00:00:00Z",
      query: null,
      calendarId: null,
      rsvpStatus: null,
      allDay: null,
    });

    expect(calService.fetchEvents).toHaveBeenCalledWith(
      userId,
      "2026-04-01T00:00:00Z",
      "2026-04-02T00:00:00Z",
    );
    expect(icsService.fetchEvents).toHaveBeenCalledWith(
      userId,
      "2026-04-01T00:00:00Z",
      "2026-04-02T00:00:00Z",
    );
  });

  it("filters out events from non-enabled calendars", async () => {
    const events = [
      {
        id: "e1",
        subscriptionId: "sub-1",
        title: "Allowed",
        startTime: "2026-04-01T09:00:00Z",
        endTime: "2026-04-01T10:00:00Z",
        allDay: false,
        attendees: [],
      },
      {
        id: "e2",
        subscriptionId: "sub-99",
        title: "Blocked",
        startTime: "2026-04-01T11:00:00Z",
        endTime: "2026-04-01T12:00:00Z",
        allDay: false,
        attendees: [],
      },
    ];
    const t = createListCalendarEventsTool(
      makeMockCalendarService(events),
      makeMockIcsService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    const result = await t.invoke({
      startDate: "2026-04-01T00:00:00Z",
      endDate: "2026-04-02T00:00:00Z",
      query: null,
      calendarId: null,
      rsvpStatus: null,
      allDay: null,
    });
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("e1");
  });

  it("filters by query substring (case-insensitive)", async () => {
    const events = [
      {
        id: "e1",
        subscriptionId: "sub-1",
        title: "Team Standup",
        description: "Daily sync",
        startTime: "2026-04-01T09:00:00Z",
        endTime: "2026-04-01T09:30:00Z",
        allDay: false,
        attendees: [],
      },
      {
        id: "e2",
        subscriptionId: "sub-1",
        title: "Lunch",
        startTime: "2026-04-01T12:00:00Z",
        endTime: "2026-04-01T13:00:00Z",
        allDay: false,
        attendees: [],
      },
    ];
    const t = createListCalendarEventsTool(
      makeMockCalendarService(events),
      makeMockIcsService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    const result = await t.invoke({
      startDate: "2026-04-01T00:00:00Z",
      endDate: "2026-04-02T00:00:00Z",
      query: "standup",
      calendarId: null,
      rsvpStatus: null,
      allDay: null,
    });
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("Team Standup");
  });

  it("filters by rsvpStatus", async () => {
    const events = [
      {
        id: "e1",
        subscriptionId: "sub-1",
        title: "Accepted",
        startTime: "2026-04-01T09:00:00Z",
        endTime: "2026-04-01T10:00:00Z",
        allDay: false,
        attendees: [{ email: "me@test.com", responseStatus: "accepted", self: true }],
      },
      {
        id: "e2",
        subscriptionId: "sub-1",
        title: "Declined",
        startTime: "2026-04-01T11:00:00Z",
        endTime: "2026-04-01T12:00:00Z",
        allDay: false,
        attendees: [{ email: "me@test.com", responseStatus: "declined", self: true }],
      },
    ];
    const t = createListCalendarEventsTool(
      makeMockCalendarService(events),
      makeMockIcsService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    const result = await t.invoke({
      startDate: "2026-04-01T00:00:00Z",
      endDate: "2026-04-02T00:00:00Z",
      query: null,
      calendarId: null,
      rsvpStatus: "declined",
      allDay: null,
    });
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("Declined");
  });

  it("filters by calendarId", async () => {
    const events = [
      {
        id: "e1",
        subscriptionId: "sub-1",
        title: "Cal 1",
        startTime: "2026-04-01T09:00:00Z",
        endTime: "2026-04-01T10:00:00Z",
        allDay: false,
        attendees: [],
      },
      {
        id: "e2",
        subscriptionId: "sub-2",
        title: "Cal 2",
        startTime: "2026-04-01T11:00:00Z",
        endTime: "2026-04-01T12:00:00Z",
        allDay: false,
        attendees: [],
      },
    ];
    const t = createListCalendarEventsTool(
      makeMockCalendarService(events),
      makeMockIcsService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    const result = await t.invoke({
      startDate: "2026-04-01T00:00:00Z",
      endDate: "2026-04-02T00:00:00Z",
      query: null,
      calendarId: "sub-2",
      rsvpStatus: null,
      allDay: null,
    });
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("Cal 2");
  });

  it("filters by allDay boolean", async () => {
    const events = [
      {
        id: "e1",
        subscriptionId: "sub-1",
        title: "All Day",
        startTime: "2026-04-01",
        endTime: "2026-04-02",
        allDay: true,
        attendees: [],
      },
      {
        id: "e2",
        subscriptionId: "sub-1",
        title: "Timed",
        startTime: "2026-04-01T09:00:00Z",
        endTime: "2026-04-01T10:00:00Z",
        allDay: false,
        attendees: [],
      },
    ];
    const t = createListCalendarEventsTool(
      makeMockCalendarService(events),
      makeMockIcsService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    const result = await t.invoke({
      startDate: "2026-04-01T00:00:00Z",
      endDate: "2026-04-02T00:00:00Z",
      query: null,
      calendarId: null,
      rsvpStatus: null,
      allDay: false,
    });
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("Timed");
  });

  it("caps results at 50", async () => {
    const events = Array.from({ length: 60 }, (_, i) => ({
      id: `e${i}`,
      subscriptionId: "sub-1",
      title: `Event ${i}`,
      startTime: `2026-04-01T${String(i % 24).padStart(2, "0")}:00:00Z`,
      endTime: `2026-04-01T${String((i % 24) + 1).padStart(2, "0")}:00:00Z`,
      allDay: false,
      attendees: [],
    }));
    const t = createListCalendarEventsTool(
      makeMockCalendarService(events),
      makeMockIcsService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    const result = await t.invoke({
      startDate: "2026-04-01T00:00:00Z",
      endDate: "2026-04-02T00:00:00Z",
      query: null,
      calendarId: null,
      rsvpStatus: null,
      allDay: null,
    });
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveLength(50);
  });

  it("returns error when calendarId is not in enabled set", async () => {
    const t = createListCalendarEventsTool(
      makeMockCalendarService(),
      makeMockIcsService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    const result = await t.invoke({
      startDate: "2026-04-01T00:00:00Z",
      endDate: "2026-04-02T00:00:00Z",
      query: null,
      calendarId: "sub-99",
      rsvpStatus: null,
      allDay: null,
    });

    expect(result).toContain("not enabled for AI access");
  });

  it("returns empty array when no events match", async () => {
    const t = createListCalendarEventsTool(
      makeMockCalendarService([]),
      makeMockIcsService([]),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    const result = await t.invoke({
      startDate: "2026-04-01T00:00:00Z",
      endDate: "2026-04-02T00:00:00Z",
      query: null,
      calendarId: null,
      rsvpStatus: null,
      allDay: null,
    });
    const parsed = JSON.parse(result as string);

    expect(parsed).toEqual([]);
  });
});
