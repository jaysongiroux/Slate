import { createCreateCalendarEventTool } from "./create-calendar-event.tool";

const userId = "user-1";
const enabledCalendarIds = ["sub-1"];
const enabledIcsIds = ["ics-1"];

function makeMockCalendarService(createdEvent: any = { id: "new-1", title: "Test" }) {
  return {
    createEvent: jest.fn().mockResolvedValue(createdEvent),
  } as any;
}

function makeMockLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
}

describe("createCreateCalendarEventTool", () => {
  it("returns a tool with name 'create_calendar_event'", () => {
    const t = createCreateCalendarEventTool(makeMockCalendarService(), userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());
    expect(t.name).toBe("create_calendar_event");
  });

  it("calls CalendarService.createEvent with correct arguments", async () => {
    const calService = makeMockCalendarService({ id: "new-1", title: "Team Lunch", calendarName: "Work" });
    const t = createCreateCalendarEventTool(calService, userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());

    await t.invoke({
      subscriptionId: "sub-1",
      title: "Team Lunch",
      startTime: "2026-04-03T12:00:00Z",
      endTime: "2026-04-03T13:00:00Z",
      description: "At the cafe",
      location: "Cafe",
      allDay: false,
    });

    expect(calService.createEvent).toHaveBeenCalledWith(userId, "sub-1", {
      title: "Team Lunch",
      startTime: "2026-04-03T12:00:00Z",
      endTime: "2026-04-03T13:00:00Z",
      description: "At the cafe",
      location: "Cafe",
      allDay: false,
    });
  });

  it("returns confirmation message on success", async () => {
    const calService = makeMockCalendarService({ id: "new-1", title: "Team Lunch", calendarName: "Work" });
    const t = createCreateCalendarEventTool(calService, userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());

    const result = await t.invoke({
      subscriptionId: "sub-1",
      title: "Team Lunch",
      startTime: "2026-04-03T12:00:00Z",
      endTime: "2026-04-03T13:00:00Z",
      description: null,
      location: null,
      allDay: false,
    });

    expect(result).toContain("Created event");
    expect(result).toContain("Team Lunch");
    expect(result).toContain("new-1");
  });

  it("rejects when subscriptionId is not in enabled set", async () => {
    const t = createCreateCalendarEventTool(makeMockCalendarService(), userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());
    const result = await t.invoke({
      subscriptionId: "sub-99",
      title: "Test",
      startTime: "2026-04-03T12:00:00Z",
      endTime: "2026-04-03T13:00:00Z",
      description: null,
      location: null,
      allDay: false,
    });
    expect(result).toContain("not enabled for AI access");
  });

  it("rejects when subscriptionId is an ICS feed", async () => {
    const t = createCreateCalendarEventTool(makeMockCalendarService(), userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());
    const result = await t.invoke({
      subscriptionId: "ics-1",
      title: "Test",
      startTime: "2026-04-03T12:00:00Z",
      endTime: "2026-04-03T13:00:00Z",
      description: null,
      location: null,
      allDay: false,
    });
    expect(result).toContain("read-only ICS feed");
  });

  it("returns error message when CalendarService throws", async () => {
    const calService = { createEvent: jest.fn().mockRejectedValue(new Error("API quota exceeded")) } as any;
    const t = createCreateCalendarEventTool(calService, userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());
    const result = await t.invoke({
      subscriptionId: "sub-1",
      title: "Test",
      startTime: "2026-04-03T12:00:00Z",
      endTime: "2026-04-03T13:00:00Z",
      description: null,
      location: null,
      allDay: false,
    });
    expect(result).toContain("Calendar API error");
    expect(result).toContain("API quota exceeded");
  });
});
