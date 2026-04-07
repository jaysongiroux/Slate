import { createRsvpCalendarEventTool } from "./rsvp-calendar-event.tool";

const userId = "user-1";
const enabledCalendarIds = ["sub-1"];
const enabledIcsIds = ["ics-1"];

function makeMockCalendarService() {
  return {
    rsvpEvent: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function makeMockLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
}

describe("createRsvpCalendarEventTool", () => {
  it("returns a tool with name 'rsvp_calendar_event'", () => {
    const t = createRsvpCalendarEventTool(
      makeMockCalendarService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );
    expect(t.name).toBe("rsvp_calendar_event");
  });

  it("calls CalendarService.rsvpEvent with correct arguments", async () => {
    const calService = makeMockCalendarService();
    const t = createRsvpCalendarEventTool(
      calService,
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    await t.invoke({ subscriptionId: "sub-1", eventId: "e1", response: "accepted" });

    expect(calService.rsvpEvent).toHaveBeenCalledWith(userId, "sub-1", "e1", "accepted");
  });

  it("returns confirmation message on success", async () => {
    const t = createRsvpCalendarEventTool(
      makeMockCalendarService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );
    const result = await t.invoke({
      subscriptionId: "sub-1",
      eventId: "e1",
      response: "tentative",
    });
    expect(result).toContain("RSVP'd tentative");
  });

  it("rejects when subscriptionId is not in enabled set", async () => {
    const t = createRsvpCalendarEventTool(
      makeMockCalendarService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );
    const result = await t.invoke({
      subscriptionId: "sub-99",
      eventId: "e1",
      response: "accepted",
    });
    expect(result).toContain("not enabled for AI access");
  });

  it("rejects when subscriptionId is an ICS feed", async () => {
    const t = createRsvpCalendarEventTool(
      makeMockCalendarService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );
    const result = await t.invoke({ subscriptionId: "ics-1", eventId: "e1", response: "accepted" });
    expect(result).toContain("read-only ICS feed");
  });

  it("returns error message when CalendarService throws", async () => {
    const calService = {
      rsvpEvent: jest.fn().mockRejectedValue(new Error("Event not found")),
    } as any;
    const t = createRsvpCalendarEventTool(
      calService,
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );
    const result = await t.invoke({ subscriptionId: "sub-1", eventId: "e1", response: "declined" });
    expect(result).toContain("Calendar API error");
    expect(result).toContain("Event not found");
  });
});
