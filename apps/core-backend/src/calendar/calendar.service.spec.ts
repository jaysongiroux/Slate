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

  function makeService(prismaOverrides: Record<string, unknown> = {}, providerOverrides: object = {}) {
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
      ...providerOverrides,
    };

    return {
      prisma,
      provider,
      service: new CalendarService(prisma as any, makeConfig(), provider as any),
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
