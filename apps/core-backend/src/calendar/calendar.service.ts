import pino from "pino";
import type { AppConfig } from "../lib/types";
import type { PrismaClient } from "@slate/server-db";
import { badRequest, notFound, preconditionFailed } from "../lib/errors";
import { encryptSecret, decryptSecret } from "../ai/encryption.util";
import type { CalendarProvider } from "./calendar-provider.interface";
import { GoogleCalendarProvider } from "./google-calendar.provider";
import { GOOGLE_ATTENDEE_SEARCH_SCOPES } from "./google-calendar.provider";
import {
  decryptCalendarSecret,
  encryptCalendarSecret,
  hashCalendarSecret,
} from "./calendar-crypto.util";

export interface CalendarEventResult {
  id: string;
  subscriptionId?: string;
  calendarId: string;
  calendarName?: string;
  source: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  color: string;
  htmlLink?: string;
  readOnly: boolean;
  conferenceLink?: string;
  conferenceName?: string;
  attendees?: { email: string; displayName?: string; responseStatus?: string; self?: boolean }[];
}

export interface CalendarAttendeeSearchResult {
  email: string;
  displayName?: string;
  personId?: string;
  source: "contacts" | "otherContacts" | "directory";
}

type CalendarConnectionWithSubscriptions = {
  id: string;
  provider: string;
  accountIdentifier: string;
  subscriptions: Array<{
    id: string;
    externalCalendarId: string;
    name: string;
    color: string;
    enabled: boolean;
  }>;
};

type IcsSubscriptionRecord = {
  id: string;
  urlEncrypted: string;
  urlHash: string | null;
  name: string;
  color: string;
  enabled: boolean;
};

export class CalendarService {
  private readonly logger = pino({ name: "CalendarService" });
  private readonly providers: Map<string, CalendarProvider>;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly googleProvider: GoogleCalendarProvider,
  ) {
    this.providers = new Map([
      ["google", this.googleProvider],
      // Future: ["outlook", this.outlookProvider], ["caldav", this.caldavProvider]
    ]);
    if (this.encryptionKey === "local-dev-calendar-secret") {
      this.logger.warn(
        "CALENDAR_ENCRYPTION_KEY is not set — using insecure default. Set it in production.",
      );
    }
  }

  private get encryptionKey(): string {
    return this.config.get("CALENDAR_ENCRYPTION_KEY", "local-dev-calendar-secret");
  }

  private encrypt(plaintext: string): string {
    return encryptSecret(plaintext, this.encryptionKey);
  }

  private decrypt(ciphertext: string): string {
    return decryptSecret(ciphertext, this.encryptionKey);
  }

  private decryptIcsUrl(urlEncrypted: string): string {
    return decryptCalendarSecret(urlEncrypted, this.encryptionKey);
  }

  private getProvider(providerId: string): CalendarProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw badRequest(`Unknown calendar provider: ${providerId}`);
    return provider;
  }

  // ── Status ──

  async getStatus(userId: string) {
    const connections = await this.prisma.calendarConnection.findMany({
      where: { userId },
      include: { subscriptions: true },
    });
    const icsSubscriptions = await this.prisma.icsSubscription.findMany({ where: { userId } });
    const providers = await Promise.all(
      Array.from(this.providers.entries()).map(async ([id, p]) => ({
        providerId: id,
        label: id.charAt(0).toUpperCase() + id.slice(1),
        configured: await p.isConfigured(),
      })),
    );

    return {
      providers,
      connections: connections.map((c: CalendarConnectionWithSubscriptions) => ({
        id: c.id,
        provider: c.provider,
        email: c.accountIdentifier,
        calendars: c.subscriptions.map((s) => ({
          subscriptionId: s.id,
          calendarId: s.externalCalendarId,
          name: s.name,
          color: s.color,
          enabled: s.enabled,
        })),
      })),
      icsSubscriptions: await Promise.all(
        icsSubscriptions.map(async (s: IcsSubscriptionRecord) => ({
          id: s.id,
          url: await this.decryptStoredIcsUrl(s.id, s.urlEncrypted, s.urlHash),
          name: s.name,
          color: s.color,
          enabled: s.enabled,
        })),
      ),
    };
  }

  private async decryptStoredIcsUrl(
    id: string,
    urlEncrypted: string,
    urlHash: string | null,
  ): Promise<string> {
    try {
      const decrypted = this.decryptIcsUrl(urlEncrypted);
      const nextHash = hashCalendarSecret(decrypted);
      if (urlHash !== nextHash) {
        await this.prisma.icsSubscription.update({
          where: { id },
          data: { urlHash: nextHash },
        });
      }
      return decrypted;
    } catch {
      const legacyPlaintextUrl = urlEncrypted;
      await this.prisma.icsSubscription.update({
        where: { id },
        data: {
          urlEncrypted: encryptCalendarSecret(legacyPlaintextUrl, this.encryptionKey),
          urlHash: hashCalendarSecret(legacyPlaintextUrl),
        },
      });
      return legacyPlaintextUrl;
    }
  }

  // ── OAuth ──

  async startOAuth(userId: string, providerId: string, redirectUri: string) {
    const provider = this.getProvider(providerId);
    if (!(await provider.isConfigured())) {
      throw preconditionFailed(`${providerId} calendar is not configured on this server.`);
    }
    return provider.startOAuth(userId, redirectUri);
  }

  async completeOAuth(
    code: string,
    state: string,
    providerId: string,
    userId: string,
    redirectUri: string,
  ) {
    const provider = this.getProvider(providerId);
    const tokens = await provider.completeOAuth(code, state, redirectUri);

    const connection = await this.prisma.calendarConnection.upsert({
      where: {
        userId_provider_accountIdentifier: {
          userId,
          provider: providerId,
          accountIdentifier: tokens.accountIdentifier,
        },
      },
      update: {
        accessTokenEncrypted: this.encrypt(tokens.accessToken),
        refreshTokenEncrypted: this.encrypt(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      },
      create: {
        userId,
        provider: providerId,
        accountIdentifier: tokens.accountIdentifier,
        accessTokenEncrypted: this.encrypt(tokens.accessToken),
        refreshTokenEncrypted: this.encrypt(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      },
      include: { subscriptions: true },
    });

    return {
      id: connection.id,
      provider: connection.provider,
      email: connection.accountIdentifier,
      calendars: [],
    };
  }

  // ── Connection management ──

  async disconnect(userId: string, connectionId: string) {
    const conn = await this.prisma.calendarConnection.findFirst({
      where: { id: connectionId, userId },
    });
    if (!conn) throw notFound("Connection not found.");

    try {
      const provider = this.getProvider(conn.provider);
      await provider.revokeToken(this.decrypt(conn.accessTokenEncrypted));
    } catch {
      this.logger.warn(`Failed to revoke token for connection ${connectionId}`);
    }

    await this.prisma.calendarConnection.delete({ where: { id: connectionId } });
  }

  // ── Calendar list ──

  async listCalendars(userId: string, connectionId: string) {
    const conn = await this.getConnectionForUser(userId, connectionId);
    const accessToken = await this.getRefreshedAccessToken(conn);
    const provider = this.getProvider(conn.provider);
    return provider.listCalendars(accessToken);
  }

  // ── Subscription CRUD ──

  async subscribe(
    userId: string,
    connectionId: string,
    calendarId: string,
    name: string,
    color: string,
  ) {
    await this.getConnectionForUser(userId, connectionId);
    const sub = await this.prisma.calendarSubscription.upsert({
      where: {
        userId_connectionId_externalCalendarId: {
          userId,
          connectionId,
          externalCalendarId: calendarId,
        },
      },
      update: { name, color, enabled: true },
      create: { userId, connectionId, externalCalendarId: calendarId, name, color },
    });
    return {
      subscriptionId: sub.id,
      calendarId: sub.externalCalendarId,
      name: sub.name,
      color: sub.color,
      enabled: sub.enabled,
    };
  }

  async unsubscribe(userId: string, subscriptionId: string) {
    const sub = await this.prisma.calendarSubscription.findFirst({
      where: { id: subscriptionId, userId },
    });
    if (!sub) throw notFound("Subscription not found.");
    await this.prisma.calendarSubscription.delete({ where: { id: subscriptionId } });
  }

  async updateSubscription(
    userId: string,
    subscriptionId: string,
    color?: string,
    enabled?: boolean,
  ) {
    const sub = await this.prisma.calendarSubscription.findFirst({
      where: { id: subscriptionId, userId },
    });
    if (!sub) throw notFound("Subscription not found.");
    const updated = await this.prisma.calendarSubscription.update({
      where: { id: subscriptionId },
      data: {
        ...(color !== undefined ? { color } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      },
    });
    return {
      subscriptionId: updated.id,
      calendarId: updated.externalCalendarId,
      name: updated.name,
      color: updated.color,
      enabled: updated.enabled,
    };
  }

  // ── Event operations (provider-agnostic) ──

  async fetchEvents(userId: string, timeMin: string, timeMax: string) {
    const subscriptions = await this.prisma.calendarSubscription.findMany({
      where: { userId, enabled: true },
      include: { connection: true },
    });

    const events: CalendarEventResult[] = [];
    for (const sub of subscriptions) {
      try {
        const accessToken = await this.getRefreshedAccessToken(sub.connection);
        const provider = this.getProvider(sub.connection.provider);
        const providerEvents = await provider.fetchEvents(
          accessToken,
          sub.externalCalendarId,
          timeMin,
          timeMax,
        );
        for (const e of providerEvents) {
          events.push({
            ...e,
            subscriptionId: sub.id,
            calendarId: sub.externalCalendarId,
            source: sub.connection.provider,
            calendarName: sub.name,
            color: sub.color,
            readOnly: false,
          });
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to fetch events for ${sub.name} (${sub.externalCalendarId}): ${errMsg}`,
        );
      }
    }
    return events;
  }

  async searchAttendees(
    userId: string,
    subscriptionId: string,
    query: string,
  ): Promise<CalendarAttendeeSearchResult[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    const sub = await this.prisma.calendarSubscription.findFirst({
      where: { id: subscriptionId, userId },
      include: { connection: true },
    });
    if (!sub) throw notFound("Subscription not found.");
    if (sub.connection.provider !== "google") return [];

    const hasContactsScope = this.hasAnyScope(
      sub.connection.scopes,
      GOOGLE_ATTENDEE_SEARCH_SCOPES[0],
      GOOGLE_ATTENDEE_SEARCH_SCOPES[1],
      GOOGLE_ATTENDEE_SEARCH_SCOPES[2],
    );
    if (!hasContactsScope) {
      throw preconditionFailed(
        "Reconnect Google to enable attendee search.",
        "needs_reauth",
      );
    }

    const accessToken = await this.getRefreshedAccessToken(sub.connection);
    const provider = this.getProvider(sub.connection.provider);
    return provider.searchAttendees(accessToken, trimmedQuery, {
      includeContacts: this.hasAnyScope(sub.connection.scopes, GOOGLE_ATTENDEE_SEARCH_SCOPES[0]),
      includeOtherContacts: this.hasAnyScope(sub.connection.scopes, GOOGLE_ATTENDEE_SEARCH_SCOPES[1]),
      includeDirectory: this.hasAnyScope(sub.connection.scopes, GOOGLE_ATTENDEE_SEARCH_SCOPES[2]),
    });
  }

  async createEvent(
    userId: string,
    subscriptionId: string,
    data: {
      title: string;
      description?: string;
      location?: string;
      startTime: string;
      endTime: string;
      allDay: boolean;
      attendees?: { email: string; displayName?: string }[];
    },
  ) {
    const sub = await this.prisma.calendarSubscription.findFirst({
      where: { id: subscriptionId, userId },
      include: { connection: true },
    });
    if (!sub) throw notFound("Subscription not found.");
    const accessToken = await this.getRefreshedAccessToken(sub.connection);
    const provider = this.getProvider(sub.connection.provider);
    const event = await provider.createEvent(accessToken, {
      calendarId: sub.externalCalendarId,
      ...data,
    });
    return {
      ...event,
      subscriptionId: sub.id,
      calendarId: sub.externalCalendarId,
      calendarName: sub.name,
      source: sub.connection.provider,
      color: sub.color,
      readOnly: false,
    };
  }

  async updateEvent(
    userId: string,
    subscriptionId: string,
    eventId: string,
    data: {
      title?: string;
      description?: string;
      location?: string;
      startTime?: string;
      endTime?: string;
      allDay?: boolean;
      attendees?: { email: string; displayName?: string }[];
    },
  ) {
    const sub = await this.prisma.calendarSubscription.findFirst({
      where: { id: subscriptionId, userId },
      include: { connection: true },
    });
    if (!sub) throw notFound("Subscription not found.");
    const accessToken = await this.getRefreshedAccessToken(sub.connection);
    const provider = this.getProvider(sub.connection.provider);
    const event = await provider.updateEvent(accessToken, {
      calendarId: sub.externalCalendarId,
      eventId,
      ...data,
    });
    return {
      ...event,
      subscriptionId: sub.id,
      calendarId: sub.externalCalendarId,
      calendarName: sub.name,
      source: sub.connection.provider,
      color: sub.color,
      readOnly: false,
    };
  }

  async deleteEvent(userId: string, subscriptionId: string, eventId: string) {
    const sub = await this.prisma.calendarSubscription.findFirst({
      where: { id: subscriptionId, userId },
      include: { connection: true },
    });
    if (!sub) throw notFound("Subscription not found.");
    const accessToken = await this.getRefreshedAccessToken(sub.connection);
    const provider = this.getProvider(sub.connection.provider);
    await provider.deleteEvent(accessToken, sub.externalCalendarId, eventId);
  }

  async rsvpEvent(userId: string, subscriptionId: string, eventId: string, response: string) {
    const sub = await this.prisma.calendarSubscription.findFirst({
      where: { id: subscriptionId, userId },
      include: { connection: true },
    });
    if (!sub) throw notFound("Subscription not found.");
    const accessToken = await this.getRefreshedAccessToken(sub.connection);
    const provider = this.getProvider(sub.connection.provider);
    await provider.rsvpEvent(accessToken, sub.externalCalendarId, eventId, response);
  }

  // ── Internal helpers ──

  /** Always filters by userId — prevents cross-user access. */
  private async getConnectionForUser(userId: string, connectionId: string) {
    const conn = await this.prisma.calendarConnection.findFirst({
      where: { id: connectionId, userId },
    });
    if (!conn) throw notFound("Connection not found.");
    return conn;
  }

  private hasAnyScope(scopes: string | null | undefined, ...requiredScopes: string[]): boolean {
    const granted = new Set(
      (scopes ?? "")
        .split(/[,\s]+/)
        .map((scope) => scope.trim())
        .filter(Boolean),
    );
    return requiredScopes.some((scope) => granted.has(scope));
  }

  /** Decrypt access token and refresh if near expiry. Re-encrypts updated tokens. */
  private async getRefreshedAccessToken(connection: {
    id: string;
    provider: string;
    scopes?: string | null;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    tokenExpiresAt: Date;
  }): Promise<string> {
    let accessToken = this.decrypt(connection.accessTokenEncrypted);

    // Refresh if within 5 minutes of expiry
    if (connection.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
      const provider = this.getProvider(connection.provider);
      const refreshToken = this.decrypt(connection.refreshTokenEncrypted);
      const newTokens = await provider.refreshTokens(refreshToken);

      await this.prisma.calendarConnection.update({
        where: { id: connection.id },
        data: {
          accessTokenEncrypted: this.encrypt(newTokens.accessToken),
          refreshTokenEncrypted: this.encrypt(newTokens.refreshToken),
          tokenExpiresAt: newTokens.expiresAt,
        },
      });

      accessToken = newTokens.accessToken;
    }

    return accessToken;
  }
}
