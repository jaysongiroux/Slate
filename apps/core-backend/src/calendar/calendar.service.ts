import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RpcException } from "@nestjs/microservices";
import { status as GrpcStatus } from "@grpc/grpc-js";
import { PrismaService } from "../prisma/prisma.service";
import { encryptSecret, decryptSecret } from "../ai/encryption.util";
import type { CalendarProvider } from "./calendar-provider.interface";
import { GoogleCalendarProvider } from "./google-calendar.provider";

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
}

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);
  private readonly providers: Map<string, CalendarProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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
    return this.config.get<string>("CALENDAR_ENCRYPTION_KEY", "local-dev-calendar-secret");
  }

  private encrypt(plaintext: string): string {
    return encryptSecret(plaintext, this.encryptionKey);
  }

  private decrypt(ciphertext: string): string {
    return decryptSecret(ciphertext, this.encryptionKey);
  }

  private getProvider(providerId: string): CalendarProvider {
    const provider = this.providers.get(providerId);
    if (!provider)
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `Unknown calendar provider: ${providerId}`,
      });
    return provider;
  }

  // ── Status ──

  async getStatus(userId: string) {
    const connections = await this.prisma.calendarConnection.findMany({
      where: { userId },
      include: { subscriptions: true },
    });
    const icsSubscriptions = await this.prisma.icsSubscription.findMany({ where: { userId } });
    const providers = Array.from(this.providers.entries()).map(([id, p]) => ({
      providerId: id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      configured: p.isConfigured(),
    }));

    return {
      providers,
      connections: connections.map((c) => ({
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
      icsSubscriptions: icsSubscriptions.map((s) => ({
        id: s.id,
        url: s.url,
        name: s.name,
        color: s.color,
        enabled: s.enabled,
      })),
    };
  }

  // ── OAuth ──

  startOAuth(userId: string, providerId: string) {
    const provider = this.getProvider(providerId);
    if (!provider.isConfigured()) {
      throw new RpcException({
        code: GrpcStatus.FAILED_PRECONDITION,
        message: `${providerId} calendar is not configured on this server.`,
      });
    }
    return provider.startOAuth(userId);
  }

  async completeOAuth(code: string, state: string, providerId: string, userId: string) {
    const provider = this.getProvider(providerId);
    const tokens = await provider.completeOAuth(code, state);

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
    if (!conn)
      throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "Connection not found." });

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
    if (!sub)
      throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "Subscription not found." });
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
    if (!sub)
      throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "Subscription not found." });
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
        this.logger.warn(`Failed to fetch events for ${sub.externalCalendarId}: ${error}`);
      }
    }
    return events;
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
    },
  ) {
    const sub = await this.prisma.calendarSubscription.findFirst({
      where: { id: subscriptionId, userId },
      include: { connection: true },
    });
    if (!sub)
      throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "Subscription not found." });
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
    },
  ) {
    const sub = await this.prisma.calendarSubscription.findFirst({
      where: { id: subscriptionId, userId },
      include: { connection: true },
    });
    if (!sub)
      throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "Subscription not found." });
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
    if (!sub)
      throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "Subscription not found." });
    const accessToken = await this.getRefreshedAccessToken(sub.connection);
    const provider = this.getProvider(sub.connection.provider);
    await provider.deleteEvent(accessToken, sub.externalCalendarId, eventId);
  }

  // ── Internal helpers ──

  /** Always filters by userId — prevents cross-user access. */
  private async getConnectionForUser(userId: string, connectionId: string) {
    const conn = await this.prisma.calendarConnection.findFirst({
      where: { id: connectionId, userId },
    });
    if (!conn)
      throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "Connection not found." });
    return conn;
  }

  /** Decrypt access token and refresh if near expiry. Re-encrypts updated tokens. */
  private async getRefreshedAccessToken(connection: {
    id: string;
    provider: string;
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
