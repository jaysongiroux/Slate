import { createUpdateCalendarEventTool } from "./update-calendar-event.tool";

const userId = "user-1";
const enabledCalendarIds = ["sub-1"];
const enabledIcsIds = ["ics-1"];

function makeMockCalendarService(updatedEvent: any = { id: "e1", title: "Updated" }) {
  return {
    updateEvent: jest.fn().mockResolvedValue(updatedEvent),
  } as any;
}

function makeMockLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
}

describe("createUpdateCalendarEventTool", () => {
  it("returns a tool with name 'update_calendar_event'", () => {
    const t = createUpdateCalendarEventTool(makeMockCalendarService(), userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());
    expect(t.name).toBe("update_calendar_event");
  });

  it("calls CalendarService.updateEvent with only provided fields", async () => {
    const calService = makeMockCalendarService({ id: "e1", title: "New Title" });
    const t = createUpdateCalendarEventTool(calService, userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());

    await t.invoke({
      subscriptionId: "sub-1",
      eventId: "e1",
      title: "New Title",
      startTime: null,
      endTime: null,
      description: null,
      location: null,
      allDay: null,
    });

    expect(calService.updateEvent).toHaveBeenCalledWith(userId, "sub-1", "e1", { title: "New Title" });
  });

  it("passes all fields when all are provided", async () => {
    const calService = makeMockCalendarService({ id: "e1", title: "Full Update" });
    const t = createUpdateCalendarEventTool(calService, userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());

    await t.invoke({
      subscriptionId: "sub-1",
      eventId: "e1",
      title: "Full Update",
      startTime: "2026-04-03T14:00:00Z",
      endTime: "2026-04-03T15:00:00Z",
      description: "New desc",
      location: "Room 5",
      allDay: false,
    });

    expect(calService.updateEvent).toHaveBeenCalledWith(userId, "sub-1", "e1", {
      title: "Full Update",
      startTime: "2026-04-03T14:00:00Z",
      endTime: "2026-04-03T15:00:00Z",
      description: "New desc",
      location: "Room 5",
      allDay: false,
    });
  });

  it("returns confirmation message on success", async () => {
    const calService = makeMockCalendarService({ id: "e1", title: "Updated Title" });
    const t = createUpdateCalendarEventTool(calService, userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());

    const result = await t.invoke({
      subscriptionId: "sub-1",
      eventId: "e1",
      title: "Updated Title",
      startTime: null,
      endTime: null,
      description: null,
      location: null,
      allDay: null,
    });

    expect(result).toContain("Updated event");
    expect(result).toContain("Updated Title");
  });

  it("rejects when subscriptionId is not in enabled set", async () => {
    const t = createUpdateCalendarEventTool(makeMockCalendarService(), userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());
    const result = await t.invoke({
      subscriptionId: "sub-99",
      eventId: "e1",
      title: "X",
      startTime: null,
      endTime: null,
      description: null,
      location: null,
      allDay: null,
    });
    expect(result).toContain("not enabled for AI access");
  });

  it("rejects when subscriptionId is an ICS feed", async () => {
    const t = createUpdateCalendarEventTool(makeMockCalendarService(), userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());
    const result = await t.invoke({
      subscriptionId: "ics-1",
      eventId: "e1",
      title: "X",
      startTime: null,
      endTime: null,
      description: null,
      location: null,
      allDay: null,
    });
    expect(result).toContain("read-only ICS feed");
  });

  it("returns error message when CalendarService throws", async () => {
    const calService = { updateEvent: jest.fn().mockRejectedValue(new Error("Not found")) } as any;
    const t = createUpdateCalendarEventTool(calService, userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());
    const result = await t.invoke({
      subscriptionId: "sub-1",
      eventId: "e1",
      title: "X",
      startTime: null,
      endTime: null,
      description: null,
      location: null,
      allDay: null,
    });
    expect(result).toContain("Calendar API error");
  });
});
