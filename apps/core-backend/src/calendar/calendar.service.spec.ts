import type { AppConfig } from "../lib/types";
import { encryptSecret } from "../ai/encryption.util";
import { CalendarService } from "./calendar.service";

describe("CalendarService attendee search", () => {
  const encryptionKey = "test-calendar-secret";

  function makeConfig(): AppConfig {
    return {
      get: jest.fn((key: string, fallback?: string) =>
        key === "CALENDAR_ENCRYPTION_KEY" ? encryptionKey : (fallback ?? ""),
      ),
    };
  }

  function makeService(
    prismaOverrides: Record<string, unknown> = {},
    providerOverrides: object = {},
  ) {
    const prisma = {
      calendarSubscription: {
        findFirst: jest.fn(),
      },
      calendarConnection: {
        update: jest.fn(),
      },
      ...prismaOverrides,
    };

    const provider = {
      providerId: "google",
      isConfigured: jest.fn().mockResolvedValue(true),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn(),
      refreshTokens: jest.fn(),
      listCalendars: jest.fn(),
      fetchEvents: jest.fn(),
      createEvent: jest.fn(),
      updateEvent: jest.fn(),
      deleteEvent: jest.fn(),
      rsvpEvent: jest.fn(),
      revokeToken: jest.fn(),
      searchAttendees: jest.fn(),
      resolveContacts: jest.fn().mockResolvedValue({ attendees: [], searchedEmails: new Set() }),
      ...providerOverrides,
    };

    const contactCache = {
      lookup: jest.fn().mockResolvedValue(new Map()),
      store: jest.fn().mockResolvedValue(undefined),
      flush: jest.fn().mockResolvedValue(undefined),
      gc: jest.fn().mockResolvedValue(undefined),
    };

    return {
      prisma,
      provider,
      contactCache,
      service: new CalendarService(
        prisma as any,
        makeConfig(),
        provider as any,
        contactCache as any,
      ),
    };
  }

  function googleSubscription(overrides: Record<string, unknown> = {}) {
    return {
      id: "sub-1",
      userId: "user-1",
      externalCalendarId: "primary",
      name: "Primary",
      color: "#7c5cdc",
      connection: {
        id: "conn-1",
        provider: "google",
        scopes:
          "https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/contacts.readonly,https://www.googleapis.com/auth/directory.readonly",
        accessTokenEncrypted: encryptSecret("access-token", encryptionKey),
        refreshTokenEncrypted: encryptSecret("refresh-token", encryptionKey),
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      ...overrides,
    };
  }

  it("requires people scopes before attendee search", async () => {
    const { prisma, service, provider } = makeService();

    prisma.calendarSubscription.findFirst.mockResolvedValue({
      id: "sub-1",
      userId: "user-1",
      externalCalendarId: "primary",
      connection: {
        id: "conn-1",
        provider: "google",
        scopes: "https://www.googleapis.com/auth/calendar",
        accessTokenEncrypted: "encrypted-access",
        refreshTokenEncrypted: "encrypted-refresh",
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await expect(service.searchAttendees("user-1", "sub-1", "ali")).rejects.toMatchObject({
      statusCode: 412,
      code: "needs_reauth",
    });
    expect(provider.searchAttendees).not.toHaveBeenCalled();
  });

  it("allows directory-only attendee search when directory scope is granted", async () => {
    const { prisma, service, provider } = makeService();

    prisma.calendarSubscription.findFirst.mockResolvedValue(
      googleSubscription({
        connection: {
          id: "conn-1",
          provider: "google",
          scopes: "https://www.googleapis.com/auth/directory.readonly",
          accessTokenEncrypted: encryptSecret("access-token", encryptionKey),
          refreshTokenEncrypted: encryptSecret("refresh-token", encryptionKey),
          tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      }),
    );
    provider.searchAttendees.mockResolvedValue([
      { email: "alice@example.com", displayName: "Alice Example", source: "directory" },
    ]);

    const result = await service.searchAttendees("user-1", "sub-1", "ali");

    expect(provider.searchAttendees).toHaveBeenCalledWith("access-token", "ali", {
      includeContacts: false,
      includeOtherContacts: false,
      includeDirectory: true,
    });
    expect(result).toEqual([
      { email: "alice@example.com", displayName: "Alice Example", source: "directory" },
    ]);
  });

  it("stores search results in contact cache", async () => {
    const { prisma, provider, contactCache, service } = makeService();

    prisma.calendarSubscription.findFirst.mockResolvedValue(googleSubscription());
    provider.searchAttendees.mockResolvedValue([
      {
        email: "Alice@Example.com",
        displayName: "Alice",
        photoUrl: "https://photo/a",
        source: "directory",
      },
    ]);

    await service.searchAttendees("user-1", "sub-1", "ali");

    // Wait for fire-and-forget promise
    await new Promise((r) => setTimeout(r, 10));

    expect(contactCache.store).toHaveBeenCalledWith("user-1", [
      { email: "alice@example.com", displayName: "Alice", photoUrl: "https://photo/a" },
    ]);
  });

  it("rejects attendee search for another user's subscription", async () => {
    const { prisma, service } = makeService();

    prisma.calendarSubscription.findFirst.mockResolvedValue(null);

    await expect(service.searchAttendees("user-1", "sub-foreign", "ali")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("passes attendees through when creating events", async () => {
    const { prisma, provider, service } = makeService();

    prisma.calendarSubscription.findFirst.mockResolvedValue(googleSubscription());
    provider.createEvent.mockResolvedValue({
      id: "evt-1",
      title: "Meeting",
      startTime: "2026-04-15T10:00:00Z",
      endTime: "2026-04-15T11:00:00Z",
      allDay: false,
    });

    await service.createEvent("user-1", "sub-1", {
      title: "Meeting",
      startTime: "2026-04-15T10:00:00Z",
      endTime: "2026-04-15T11:00:00Z",
      allDay: false,
      attendees: [{ email: "alice@example.com", displayName: "Alice Example" }],
    });

    expect(provider.createEvent).toHaveBeenCalledWith(
      "access-token",
      expect.objectContaining({
        calendarId: "primary",
        attendees: [{ email: "alice@example.com", displayName: "Alice Example" }],
      }),
    );
  });

  it("passes attendees through when updating events", async () => {
    const { prisma, provider, service } = makeService();

    prisma.calendarSubscription.findFirst.mockResolvedValue(googleSubscription());
    provider.updateEvent.mockResolvedValue({
      id: "evt-1",
      title: "Meeting",
      startTime: "2026-04-15T10:00:00Z",
      endTime: "2026-04-15T11:00:00Z",
      allDay: false,
    });

    await service.updateEvent("user-1", "sub-1", "evt-1", {
      attendees: [{ email: "alice@example.com", displayName: "Alice Example" }],
    });

    expect(provider.updateEvent).toHaveBeenCalledWith(
      "access-token",
      expect.objectContaining({
        calendarId: "primary",
        eventId: "evt-1",
        attendees: [{ email: "alice@example.com", displayName: "Alice Example" }],
      }),
    );
  });
});

describe("CalendarService event hydration", () => {
  const encryptionKey = "test-calendar-secret";

  function makeConfig(): AppConfig {
    return {
      get: jest.fn((key: string, fallback?: string) =>
        key === "CALENDAR_ENCRYPTION_KEY" ? encryptionKey : (fallback ?? ""),
      ),
    };
  }

  function makeServiceWithCache(
    prismaOverrides: Record<string, unknown> = {},
    providerOverrides: object = {},
    cacheOverrides: object = {},
  ) {
    const prisma = {
      calendarSubscription: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      calendarConnection: {
        update: jest.fn(),
      },
      ...prismaOverrides,
    };

    const provider = {
      providerId: "google",
      isConfigured: jest.fn().mockResolvedValue(true),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn(),
      refreshTokens: jest.fn(),
      listCalendars: jest.fn(),
      fetchEvents: jest.fn().mockResolvedValue([]),
      createEvent: jest.fn(),
      updateEvent: jest.fn(),
      deleteEvent: jest.fn(),
      rsvpEvent: jest.fn(),
      revokeToken: jest.fn(),
      searchAttendees: jest.fn().mockResolvedValue([]),
      resolveContacts: jest.fn().mockResolvedValue({ attendees: [], searchedEmails: new Set() }),
      ...providerOverrides,
    };

    const contactCache = {
      lookup: jest.fn().mockResolvedValue(new Map()),
      store: jest.fn().mockResolvedValue(undefined),
      flush: jest.fn().mockResolvedValue(undefined),
      gc: jest.fn().mockResolvedValue(undefined),
      ...cacheOverrides,
    };

    return {
      prisma,
      provider,
      contactCache,
      service: new CalendarService(
        prisma as any,
        makeConfig(),
        provider as any,
        contactCache as any,
      ),
    };
  }

  function googleSubscription() {
    return {
      id: "sub-1",
      userId: "user-1",
      externalCalendarId: "primary",
      name: "Primary",
      color: "#7c5cdc",
      connection: {
        id: "conn-1",
        provider: "google",
        scopes:
          "https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/contacts.readonly,https://www.googleapis.com/auth/directory.readonly",
        accessTokenEncrypted: encryptSecret("access-token", encryptionKey),
        refreshTokenEncrypted: encryptSecret("refresh-token", encryptionKey),
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    };
  }

  it("hydrates attendee names from cache", async () => {
    const sub = googleSubscription();
    const { contactCache, service } = makeServiceWithCache(
      {
        calendarSubscription: {
          findMany: jest.fn().mockResolvedValue([sub]),
          findFirst: jest.fn(),
        },
      },
      {
        fetchEvents: jest.fn().mockResolvedValue([
          {
            id: "evt-1",
            title: "Standup",
            startTime: "2026-04-15T10:00:00Z",
            endTime: "2026-04-15T10:30:00Z",
            allDay: false,
            attendees: [
              { email: "alice@example.com", self: false },
              { email: "bob@example.com", self: true },
            ],
          },
        ]),
      },
      {
        lookup: jest.fn().mockResolvedValue(
          new Map([
            ["alice@example.com", { displayName: "Alice Smith", photoUrl: "https://photo/a" }],
            ["bob@example.com", { displayName: "Bob Jones", photoUrl: null }],
          ]),
        ),
      },
    );

    const events = await service.fetchEvents(
      "user-1",
      "2026-04-15T00:00:00Z",
      "2026-04-16T00:00:00Z",
    );

    expect(events[0].attendees).toEqual([
      {
        email: "alice@example.com",
        self: false,
        displayName: "Alice Smith",
        photoUrl: "https://photo/a",
      },
      { email: "bob@example.com", self: true, displayName: "Bob Jones" },
    ]);
  });

  it("looks up uncached emails via People API and stores results including negatives", async () => {
    const sub = googleSubscription();
    const { provider, contactCache, service } = makeServiceWithCache(
      {
        calendarSubscription: {
          findMany: jest.fn().mockResolvedValue([sub]),
          findFirst: jest.fn(),
        },
      },
      {
        fetchEvents: jest.fn().mockResolvedValue([
          {
            id: "evt-1",
            title: "Meeting",
            startTime: "2026-04-15T10:00:00Z",
            endTime: "2026-04-15T10:30:00Z",
            allDay: false,
            attendees: [
              { email: "alice@example.com", self: false },
              { email: "unknown@example.com", self: false },
            ],
          },
        ]),
        resolveContacts: jest.fn().mockResolvedValue({
          attendees: [
            {
              email: "alice@example.com",
              displayName: "Alice Smith",
              photoUrl: "https://photo/a",
              source: "directory",
            },
          ],
          searchedEmails: new Set(["alice@example.com", "unknown@example.com"]),
        }),
      },
      {
        lookup: jest.fn().mockResolvedValue(new Map()),
      },
    );

    const events = await service.fetchEvents(
      "user-1",
      "2026-04-15T00:00:00Z",
      "2026-04-16T00:00:00Z",
    );

    // Should only cache positive results (not negatives for unknown@example.com)
    expect(contactCache.store).toHaveBeenCalledWith("user-1", [
      { email: "alice@example.com", displayName: "Alice Smith", photoUrl: "https://photo/a" },
    ]);

    // Hydrated
    expect(events[0].attendees![0].displayName).toBe("Alice Smith");
    expect(events[0].attendees![1].displayName).toBeUndefined();
  });

  it("does not call People API when all emails are cached", async () => {
    const sub = googleSubscription();
    const { provider, contactCache, service } = makeServiceWithCache(
      {
        calendarSubscription: {
          findMany: jest.fn().mockResolvedValue([sub]),
          findFirst: jest.fn(),
        },
      },
      {
        fetchEvents: jest.fn().mockResolvedValue([
          {
            id: "evt-1",
            title: "Meeting",
            startTime: "2026-04-15T10:00:00Z",
            endTime: "2026-04-15T10:30:00Z",
            allDay: false,
            attendees: [{ email: "alice@example.com", self: false }],
          },
        ]),
      },
      {
        lookup: jest
          .fn()
          .mockResolvedValue(
            new Map([["alice@example.com", { displayName: "Alice", photoUrl: null }]]),
          ),
      },
    );

    await service.fetchEvents("user-1", "2026-04-15T00:00:00Z", "2026-04-16T00:00:00Z");

    expect(provider.resolveContacts).not.toHaveBeenCalled();
    expect(contactCache.store).not.toHaveBeenCalled();
  });
});
