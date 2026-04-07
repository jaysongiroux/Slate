import { Test, TestingModule } from "@nestjs/testing";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { IcsService } from "./ics.service";
import { AuthSessionService } from "../auth/auth-session.service";
import { HttpAuthGuard } from "../auth/http-auth.guard";

describe("CalendarController HTTP endpoints", () => {
  let controller: CalendarController;
  let calendarService: jest.Mocked<Partial<CalendarService>>;
  let icsService: jest.Mocked<Partial<IcsService>>;

  const user = { userId: "u1" };

  beforeEach(async () => {
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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CalendarController],
      providers: [
        { provide: CalendarService, useValue: calendarService },
        { provide: IcsService, useValue: icsService },
        { provide: AuthSessionService, useValue: {} },
        { provide: HttpAuthGuard, useValue: { canActivate: () => true } },
      ],
    })
      .overrideGuard(HttpAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CalendarController>(CalendarController);
  });

  it("getCalendarStatusHttp returns status", async () => {
    const result = await controller.getCalendarStatusHttp(user as any);
    expect(calendarService.getStatus).toHaveBeenCalledWith("u1");
    expect(result).toMatchObject({ connected: false });
  });

  it("fetchCalendarEventsHttp returns combined events", async () => {
    const result = await controller.fetchCalendarEventsHttp(
      "2024-01-01T00:00:00Z",
      "2024-01-31T23:59:59Z",
      user as any,
    );
    expect(result).toEqual({ events: [] });
  });

  it("createCalendarEventHttp creates event", async () => {
    const body = {
      subscriptionId: "sub1",
      title: "Meeting",
      startTime: "2024-01-15T10:00:00Z",
      endTime: "2024-01-15T11:00:00Z",
    };
    const result = await controller.createCalendarEventHttp(body, user as any);
    expect(result).toEqual({ event: { id: "ev1" } });
  });
});
