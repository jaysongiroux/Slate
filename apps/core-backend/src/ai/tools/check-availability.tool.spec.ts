import { createCheckAvailabilityTool } from "./check-availability.tool";

const userId = "user-1";
const enabledCalendarIds = ["sub-1", "sub-2"];
const enabledIcsIds = ["ics-1"];

function makeMockCalendarService(events: unknown[] = []) {
  return { fetchEvents: jest.fn().mockResolvedValue(events) } as any;
}

function makeMockIcsService(events: unknown[] = []) {
  return { fetchEvents: jest.fn().mockResolvedValue(events) } as any;
}

function makeMockLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
}

describe("createCheckAvailabilityTool", () => {
  it("returns a tool with name 'check_availability'", () => {
    const t = createCheckAvailabilityTool(
      makeMockCalendarService(),
      makeMockIcsService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );
    expect(t.name).toBe("check_availability");
  });

  it("returns free slots as gaps between busy slots", async () => {
    const events = [
      {
        id: "e1",
        subscriptionId: "sub-1",
        title: "Meeting",
        startTime: "2026-04-01T09:00:00Z",
        endTime: "2026-04-01T10:00:00Z",
        allDay: false,
      },
      {
        id: "e2",
        subscriptionId: "sub-1",
        title: "Lunch",
        startTime: "2026-04-01T12:00:00Z",
        endTime: "2026-04-01T13:00:00Z",
        allDay: false,
      },
    ];
    const t = createCheckAvailabilityTool(
      makeMockCalendarService(events),
      makeMockIcsService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    const result = await t.invoke({
      startDate: "2026-04-01T08:00:00Z",
      endDate: "2026-04-01T17:00:00Z",
    });
    const parsed = JSON.parse(result as string);

    expect(parsed.busySlots).toHaveLength(2);
    expect(parsed.freeSlots).toHaveLength(3);
    expect(parsed.freeSlots[0].start).toBe("2026-04-01T08:00:00.000Z");
    expect(parsed.freeSlots[0].end).toBe("2026-04-01T09:00:00.000Z");
    expect(parsed.freeSlots[1].start).toBe("2026-04-01T10:00:00.000Z");
    expect(parsed.freeSlots[1].end).toBe("2026-04-01T12:00:00.000Z");
    expect(parsed.freeSlots[2].start).toBe("2026-04-01T13:00:00.000Z");
    expect(parsed.freeSlots[2].end).toBe("2026-04-01T17:00:00.000Z");
  });

  it("merges overlapping busy slots", async () => {
    const events = [
      {
        id: "e1",
        subscriptionId: "sub-1",
        title: "A",
        startTime: "2026-04-01T09:00:00Z",
        endTime: "2026-04-01T10:30:00Z",
        allDay: false,
      },
      {
        id: "e2",
        subscriptionId: "sub-2",
        title: "B",
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
        allDay: false,
      },
    ];
    const t = createCheckAvailabilityTool(
      makeMockCalendarService(events),
      makeMockIcsService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    const result = await t.invoke({
      startDate: "2026-04-01T08:00:00Z",
      endDate: "2026-04-01T12:00:00Z",
    });
    const parsed = JSON.parse(result as string);

    expect(parsed.busySlots).toHaveLength(1);
    expect(parsed.busySlots[0].start).toBe("2026-04-01T09:00:00.000Z");
    expect(parsed.busySlots[0].end).toBe("2026-04-01T11:00:00.000Z");
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
      },
      {
        id: "e2",
        subscriptionId: "sub-99",
        title: "Blocked",
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
        allDay: false,
      },
    ];
    const t = createCheckAvailabilityTool(
      makeMockCalendarService(events),
      makeMockIcsService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    const result = await t.invoke({
      startDate: "2026-04-01T08:00:00Z",
      endDate: "2026-04-01T12:00:00Z",
    });
    const parsed = JSON.parse(result as string);

    expect(parsed.busySlots).toHaveLength(1);
    expect(parsed.busySlots[0].title).toBe("Allowed");
  });

  it("returns all free when no events exist", async () => {
    const t = createCheckAvailabilityTool(
      makeMockCalendarService([]),
      makeMockIcsService([]),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    const result = await t.invoke({
      startDate: "2026-04-01T08:00:00Z",
      endDate: "2026-04-01T17:00:00Z",
    });
    const parsed = JSON.parse(result as string);

    expect(parsed.busySlots).toHaveLength(0);
    expect(parsed.freeSlots).toHaveLength(1);
    expect(parsed.freeSlots[0].start).toBe("2026-04-01T08:00:00.000Z");
    expect(parsed.freeSlots[0].end).toBe("2026-04-01T17:00:00.000Z");
  });
});
