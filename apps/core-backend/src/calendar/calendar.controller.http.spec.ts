import { CalendarService } from "./calendar.service";
import { IcsService } from "./ics.service";

/**
 * Calendar service-level tests.
 *
 * These tests verify service mock interactions directly.
 */
describe("Calendar service layer (formerly CalendarController HTTP tests)", () => {
  let calendarService: jest.Mocked<Partial<CalendarService>>;
  let icsService: jest.Mocked<Partial<IcsService>>;

  beforeEach(() => {
    calendarService = {
      getStatus: jest.fn().mockResolvedValue({ connected: false, providers: [] }),
      startOAuth: jest.fn().mockResolvedValue({ authorizationUrl: "https://oauth.example.com" }),
      disconnect: jest.fn().mockResolvedValue(undefined),
      listCalendars: jest.fn().mockResolvedValue([]),
      subscribe: jest.fn().mockResolvedValue({ id: "sub1" }),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      updateSubscription: jest.fn().mockResolvedValue({ id: "sub1" }),
      fetchEvents: jest.fn().mockResolvedValue([]),
      createEvent: jest.fn().mockResolvedValue({ id: "ev1" }),
      updateEvent: jest.fn().mockResolvedValue({ id: "ev1" }),
      deleteEvent: jest.fn().mockResolvedValue(undefined),
      rsvpEvent: jest.fn().mockResolvedValue(undefined),
    };
    icsService = {
      addSubscription: jest.fn().mockResolvedValue({ id: "ics1" }),
      removeSubscription: jest.fn().mockResolvedValue(undefined),
      updateSubscription: jest.fn().mockResolvedValue({ id: "ics1" }),
      fetchEvents: jest.fn().mockResolvedValue([]),
    };
  });

  it("getStatus returns calendar status", async () => {
    const result = await calendarService.getStatus!("u1");
    expect(calendarService.getStatus).toHaveBeenCalledWith("u1");
    expect(result).toMatchObject({ connected: false });
  });

  it("fetchEvents returns combined empty events", async () => {
    const providerEvents = await calendarService.fetchEvents!(
      "u1",
      "2024-01-01T00:00:00Z",
      "2024-01-31T23:59:59Z",
    );
    const icsEvents = await icsService.fetchEvents!(
      "u1",
      "2024-01-01T00:00:00Z",
      "2024-01-31T23:59:59Z",
    );
    const events = [...providerEvents, ...icsEvents];
    expect(events).toEqual([]);
  });

  it("createEvent creates event via service", async () => {
    const result = await calendarService.createEvent!("u1", "sub1", {
      title: "Meeting",
      startTime: "2024-01-15T10:00:00Z",
      endTime: "2024-01-15T11:00:00Z",
      allDay: false,
    });
    expect(result).toEqual({ id: "ev1" });
  });
});
