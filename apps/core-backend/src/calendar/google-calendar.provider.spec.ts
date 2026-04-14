import type { AppConfig } from "../lib/types";
import { SettingsService } from "../settings/settings.service";

const mockGenerateAuthUrl = jest.fn();
const mockCalendarInsert = jest.fn();
const mockCalendarPatch = jest.fn();

jest.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: mockGenerateAuthUrl,
        setCredentials: jest.fn(),
      })),
    },
    calendar: jest.fn().mockImplementation(() => ({
      events: {
        insert: mockCalendarInsert,
        patch: mockCalendarPatch,
      },
    })),
  },
}));

describe("GoogleCalendarProvider", () => {
  beforeEach(() => {
    mockGenerateAuthUrl.mockReset();
    mockGenerateAuthUrl.mockReturnValue("https://oauth.example.com");
    mockCalendarInsert.mockReset();
    mockCalendarPatch.mockReset();
    mockCalendarInsert.mockResolvedValue({
      data: {
        id: "evt-1",
        summary: "Meeting",
        start: { dateTime: "2026-04-15T10:00:00Z" },
        end: { dateTime: "2026-04-15T11:00:00Z" },
      },
    });
    mockCalendarPatch.mockResolvedValue({
      data: {
        id: "evt-1",
        summary: "Meeting",
        start: { dateTime: "2026-04-15T10:00:00Z" },
        end: { dateTime: "2026-04-15T11:00:00Z" },
      },
    });
  });

  it("requests calendar and people scopes during OAuth start", async () => {
    const { GoogleCalendarProvider } = await import("./google-calendar.provider");

    const config: AppConfig = {
      get: jest.fn((_key: string, fallback?: string) => fallback ?? ""),
    };
    const settings = {
      getGoogleCalendarClientId: jest.fn().mockResolvedValue("client-id"),
      getGoogleCalendarClientSecret: jest.fn().mockResolvedValue("client-secret"),
    } as unknown as SettingsService;

    const provider = new GoogleCalendarProvider(config, settings);

    const result = await provider.startOAuth("user-1", "http://127.0.0.1/callback");

    expect(result.authorizationUrl).toBe("https://oauth.example.com");
    expect(mockGenerateAuthUrl).toHaveBeenCalledTimes(1);
    expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        access_type: "offline",
        prompt: "consent",
        scope: [
          "https://www.googleapis.com/auth/calendar",
          "https://www.googleapis.com/auth/contacts.readonly",
          "https://www.googleapis.com/auth/contacts.other.readonly",
          "https://www.googleapis.com/auth/directory.readonly",
        ],
        state: expect.any(String),
      }),
    );
  });

  it("sends attendee updates when creating events with guests", async () => {
    const { GoogleCalendarProvider } = await import("./google-calendar.provider");
    const config: AppConfig = {
      get: jest.fn((_key: string, fallback?: string) => fallback ?? ""),
    };
    const settings = {
      getGoogleCalendarClientId: jest.fn().mockResolvedValue("client-id"),
      getGoogleCalendarClientSecret: jest.fn().mockResolvedValue("client-secret"),
    } as unknown as SettingsService;

    const provider = new GoogleCalendarProvider(config, settings);

    await provider.createEvent("access-token", {
      calendarId: "primary",
      title: "Meeting",
      startTime: "2026-04-15T10:00:00Z",
      endTime: "2026-04-15T11:00:00Z",
      allDay: false,
      attendees: [{ email: "alice@example.com", displayName: "Alice Example" }],
    });

    expect(mockCalendarInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        sendUpdates: "all",
        requestBody: expect.objectContaining({
          attendees: [{ email: "alice@example.com", displayName: "Alice Example" }],
        }),
      }),
    );
  });

  it("does not send attendee updates when creating events without guests", async () => {
    const { GoogleCalendarProvider } = await import("./google-calendar.provider");
    const config: AppConfig = {
      get: jest.fn((_key: string, fallback?: string) => fallback ?? ""),
    };
    const settings = {
      getGoogleCalendarClientId: jest.fn().mockResolvedValue("client-id"),
      getGoogleCalendarClientSecret: jest.fn().mockResolvedValue("client-secret"),
    } as unknown as SettingsService;

    const provider = new GoogleCalendarProvider(config, settings);

    await provider.createEvent("access-token", {
      calendarId: "primary",
      title: "Solo work block",
      startTime: "2026-04-15T10:00:00Z",
      endTime: "2026-04-15T11:00:00Z",
      allDay: false,
      attendees: [],
    });

    expect(mockCalendarInsert).toHaveBeenCalledWith(
      expect.not.objectContaining({
        sendUpdates: "all",
      }),
    );
  });

  it("sends attendee updates when editing guests", async () => {
    const { GoogleCalendarProvider } = await import("./google-calendar.provider");
    const config: AppConfig = {
      get: jest.fn((_key: string, fallback?: string) => fallback ?? ""),
    };
    const settings = {
      getGoogleCalendarClientId: jest.fn().mockResolvedValue("client-id"),
      getGoogleCalendarClientSecret: jest.fn().mockResolvedValue("client-secret"),
    } as unknown as SettingsService;

    const provider = new GoogleCalendarProvider(config, settings);

    await provider.updateEvent("access-token", {
      calendarId: "primary",
      eventId: "evt-1",
      attendees: [{ email: "alice@example.com", displayName: "Alice Example" }],
    });

    expect(mockCalendarPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        eventId: "evt-1",
        sendUpdates: "all",
        requestBody: expect.objectContaining({
          attendees: [{ email: "alice@example.com", displayName: "Alice Example" }],
        }),
      }),
    );
  });
});
