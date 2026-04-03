import { createDeleteCalendarEventTool } from "./delete-calendar-event.tool";

const userId = "user-1";
const enabledCalendarIds = ["sub-1"];
const enabledIcsIds = ["ics-1"];

function makeMockCalendarService() {
  return {
    deleteEvent: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function makeMockLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
}

describe("createDeleteCalendarEventTool", () => {
  it("returns a tool with name 'delete_calendar_event'", () => {
    const t = createDeleteCalendarEventTool(makeMockCalendarService(), userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());
    expect(t.name).toBe("delete_calendar_event");
  });

  it("calls CalendarService.deleteEvent with correct arguments", async () => {
    const calService = makeMockCalendarService();
    const t = createDeleteCalendarEventTool(calService, userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());

    await t.invoke({ subscriptionId: "sub-1", eventId: "e1" });

    expect(calService.deleteEvent).toHaveBeenCalledWith(userId, "sub-1", "e1");
  });

  it("returns confirmation message on success", async () => {
    const t = createDeleteCalendarEventTool(makeMockCalendarService(), userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());
    const result = await t.invoke({ subscriptionId: "sub-1", eventId: "e1" });
    expect(result).toContain("Deleted event");
  });

  it("rejects when subscriptionId is not in enabled set", async () => {
    const t = createDeleteCalendarEventTool(makeMockCalendarService(), userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());
    const result = await t.invoke({ subscriptionId: "sub-99", eventId: "e1" });
    expect(result).toContain("not enabled for AI access");
  });

  it("rejects when subscriptionId is an ICS feed", async () => {
    const t = createDeleteCalendarEventTool(makeMockCalendarService(), userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());
    const result = await t.invoke({ subscriptionId: "ics-1", eventId: "e1" });
    expect(result).toContain("read-only ICS feed");
  });

  it("returns error message when CalendarService throws", async () => {
    const calService = { deleteEvent: jest.fn().mockRejectedValue(new Error("Forbidden")) } as any;
    const t = createDeleteCalendarEventTool(calService, userId, enabledCalendarIds, enabledIcsIds, makeMockLogger());
    const result = await t.invoke({ subscriptionId: "sub-1", eventId: "e1" });
    expect(result).toContain("Calendar API error");
    expect(result).toContain("Forbidden");
  });
});
