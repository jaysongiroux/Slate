import type { AppConfig } from "../lib/types";
import { SettingsService } from "../settings/settings.service";

const mockGenerateAuthUrl = jest.fn();
const mockCalendarInsert = jest.fn();
const mockCalendarPatch = jest.fn();
const mockSearchContacts = jest.fn();
const mockSearchDirectoryPeople = jest.fn();
const mockListDirectoryPeople = jest.fn();
const mockOtherContactsSearch = jest.fn();

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

jest.mock("@googleapis/people", () => ({
  people: jest.fn().mockImplementation(() => ({
    people: {
      searchContacts: mockSearchContacts,
      searchDirectoryPeople: mockSearchDirectoryPeople,
      listDirectoryPeople: mockListDirectoryPeople,
    },
    otherContacts: {
      search: mockOtherContactsSearch,
    },
  })),
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
    mockSearchContacts.mockReset();
    mockSearchDirectoryPeople.mockReset();
    mockListDirectoryPeople.mockReset();
    mockOtherContactsSearch.mockReset();
    mockSearchContacts.mockResolvedValue({ data: { results: [] } });
    mockSearchDirectoryPeople.mockResolvedValue({ data: { people: [] } });
    mockListDirectoryPeople.mockResolvedValue({ data: { people: [] } });
    mockOtherContactsSearch.mockResolvedValue({ data: { results: [] } });
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

  it("returns attendee photo urls from people search results", async () => {
    const { GoogleCalendarProvider } = await import("./google-calendar.provider");
    const config: AppConfig = {
      get: jest.fn((_key: string, fallback?: string) => fallback ?? ""),
    };
    const settings = {
      getGoogleCalendarClientId: jest.fn().mockResolvedValue("client-id"),
      getGoogleCalendarClientSecret: jest.fn().mockResolvedValue("client-secret"),
    } as unknown as SettingsService;

    mockSearchContacts.mockResolvedValue({
      data: {
        results: [
          {
            person: {
              resourceName: "people/c123",
              names: [{ displayName: "Alice Example" }],
              emailAddresses: [{ value: "alice@example.com" }],
              photos: [{ url: "https://example.com/alice.jpg" }],
            },
          },
        ],
      },
    });

    const provider = new GoogleCalendarProvider(config, settings);
    const attendees = await provider.searchAttendees("access-token", "alice", {
      includeContacts: true,
      includeOtherContacts: false,
      includeDirectory: false,
    });

    expect(attendees).toEqual([
      {
        email: "alice@example.com",
        displayName: "Alice Example",
        personId: "people/c123",
        photoUrl: "https://example.com/alice.jpg",
        source: "contacts",
      },
    ]);
  });

  it("falls back to contacts and other contacts when directory listing is unavailable", async () => {
    const { GoogleCalendarProvider } = await import("./google-calendar.provider");
    const config: AppConfig = {
      get: jest.fn((_key: string, fallback?: string) => fallback ?? ""),
    };
    const settings = {
      getGoogleCalendarClientId: jest.fn().mockResolvedValue("client-id"),
      getGoogleCalendarClientSecret: jest.fn().mockResolvedValue("client-secret"),
    } as unknown as SettingsService;

    mockListDirectoryPeople.mockRejectedValue(new Error("Must be a G Suite domain user."));
    mockSearchContacts.mockImplementation(({ query }: { query: string }) =>
      Promise.resolve({
        data: {
          results:
            query === "alice@example.com"
              ? [
                  {
                    person: {
                      resourceName: "people/c123",
                      names: [{ displayName: "Alice Example" }],
                      emailAddresses: [{ value: "alice@example.com" }],
                    },
                  },
                ]
              : [],
        },
      }),
    );
    mockOtherContactsSearch.mockImplementation(({ query }: { query: string }) =>
      Promise.resolve({
        data: {
          results:
            query === "bob@example.com"
              ? [
                  {
                    person: {
                      resourceName: "people/oc456",
                      names: [{ displayName: "Bob Example" }],
                      emailAddresses: [{ value: "bob@example.com" }],
                    },
                  },
                ]
              : [],
        },
      }),
    );

    const provider = new GoogleCalendarProvider(config, settings);
    const result = await provider.resolveContacts(
      "access-token",
      ["alice@example.com", "bob@example.com"],
      {
        includeContacts: true,
        includeOtherContacts: true,
        includeDirectory: true,
      },
    );

    expect(mockListDirectoryPeople).toHaveBeenCalled();
    expect(mockSearchContacts).toHaveBeenCalledWith(
      expect.objectContaining({ query: "alice@example.com" }),
    );
    expect(mockOtherContactsSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: "bob@example.com" }),
    );
    expect(result.attendees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "alice@example.com",
          displayName: "Alice Example",
          source: "contacts",
        }),
        expect.objectContaining({
          email: "bob@example.com",
          displayName: "Bob Example",
          source: "otherContacts",
        }),
      ]),
    );
  });
});
