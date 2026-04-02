import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { google, type calendar_v3 } from "googleapis";
import { randomBytes } from "node:crypto";
import type {
  CalendarProvider,
  OAuthStartResult,
  OAuthTokens,
  ProviderCalendar,
  ProviderEvent,
  CreateEventInput,
  UpdateEventInput,
} from "./calendar-provider.interface";

/**
 * In-memory store for OAuth state during the consent flow (10-min expiry).
 *
 * TODO: For multi-process / multi-replica deployments this should be moved to
 * the database (e.g. a dedicated `CalendarOAuthState` table) so that the
 * callback can land on any instance. The in-memory approach is acceptable for
 * single-process deployments, with the safeguards below (max-size cap + TTL
 * sweep on every new entry).
 */
const OAUTH_STATE_MAX_ENTRIES = 1000;
const oauthStateMap = new Map<string, { userId: string; createdAt: number }>();

/**
 * Google Calendar implementation of CalendarProvider.
 *
 * To add another provider (Outlook, CalDAV), create a similar class
 * implementing CalendarProvider and register it in CalendarModule.
 */
@Injectable()
export class GoogleCalendarProvider implements CalendarProvider {
  readonly providerId = "google";
  private readonly logger = new Logger(GoogleCalendarProvider.name);

  constructor(private readonly config: ConfigService) {}

  // ── Config ──

  private clientId(): string {
    return this.config.get<string>("GOOGLE_CALENDAR_CLIENT_ID", "");
  }

  private clientSecret(): string {
    return this.config.get<string>("GOOGLE_CALENDAR_CLIENT_SECRET", "");
  }

  private redirectUri(): string {
    return this.config.get<string>(
      "GOOGLE_CALENDAR_REDIRECT_URI",
      "http://localhost:4000/api/calendar/oauth/callback",
    );
  }

  isConfigured(): boolean {
    return Boolean(this.clientId() && this.clientSecret());
  }

  private createOAuth2Client(redirectUri?: string) {
    return new google.auth.OAuth2(this.clientId(), this.clientSecret(), redirectUri ?? this.redirectUri());
  }

  // ── OAuth ──

  startOAuth(userId: string, redirectUri: string): OAuthStartResult {
    // Expire old states first (TTL sweep)
    const now = Date.now();
    for (const [key, val] of oauthStateMap) {
      if (now - val.createdAt > 10 * 60 * 1000) oauthStateMap.delete(key);
    }

    // Prevent unbounded memory growth
    if (oauthStateMap.size >= OAUTH_STATE_MAX_ENTRIES) {
      throw new Error("Too many pending OAuth requests. Please try again later.");
    }

    const state = randomBytes(32).toString("hex");
    oauthStateMap.set(state, { userId, createdAt: Date.now() });

    const client = this.createOAuth2Client(redirectUri);
    const authorizationUrl = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/calendar"],
      state,
    });

    return { authorizationUrl, state };
  }

  async completeOAuth(code: string, state: string, redirectUri: string): Promise<OAuthTokens> {
    const pending = oauthStateMap.get(state);
    if (!pending) throw new Error("Invalid or expired OAuth state.");
    oauthStateMap.delete(state);

    const client = this.createOAuth2Client(redirectUri);
    const { tokens } = await client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error("Google did not return required tokens. Try reconnecting.");
    }

    // Resolve the account email
    client.setCredentials(tokens);
    const cal = google.calendar({ version: "v3", auth: client });
    const primary = await cal.calendarList.get({ calendarId: "primary" });

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : new Date(Date.now() + 3600_000),
      accountIdentifier: primary.data.id ?? "unknown",
      scopes: (tokens.scope ?? "").replace(/ /g, ","),
    };
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const client = this.createOAuth2Client();
    client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new Error("Token refresh did not return a new access token.");
    }

    return {
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token ?? refreshToken,
      expiresAt: credentials.expiry_date
        ? new Date(credentials.expiry_date)
        : new Date(Date.now() + 3600_000),
      accountIdentifier: "", // not changed on refresh
      scopes: "",
    };
  }

  // ── Calendar list ──

  async listCalendars(accessToken: string): Promise<ProviderCalendar[]> {
    const client = this.createOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth: client });
    const res = await cal.calendarList.list();

    return (res.data.items ?? []).map((item) => ({
      calendarId: item.id ?? "",
      name: item.summary ?? "Untitled",
      color: item.backgroundColor ?? "#7c5cdc",
      isPrimary: item.primary ?? false,
    }));
  }

  // ── Events ──

  async fetchEvents(
    accessToken: string,
    calendarId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<ProviderEvent[]> {
    const client = this.createOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth: client });

    const res = await cal.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 500,
    });

    return (res.data.items ?? []).map((item) => this.toProviderEvent(item));
  }

  async createEvent(accessToken: string, input: CreateEventInput): Promise<ProviderEvent> {
    const client = this.createOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth: client });

    const body: calendar_v3.Schema$Event = {
      summary: input.title,
      description: input.description,
      location: input.location,
      start: input.allDay ? { date: input.startTime.split("T")[0] } : { dateTime: input.startTime },
      end: input.allDay ? { date: input.endTime.split("T")[0] } : { dateTime: input.endTime },
    };

    const res = await cal.events.insert({ calendarId: input.calendarId, requestBody: body });
    return this.toProviderEvent(res.data);
  }

  async updateEvent(accessToken: string, input: UpdateEventInput): Promise<ProviderEvent> {
    const client = this.createOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth: client });

    const patch: calendar_v3.Schema$Event = {};
    if (input.title !== undefined) patch.summary = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.location !== undefined) patch.location = input.location;
    if (input.startTime !== undefined)
      patch.start = input.allDay
        ? { date: input.startTime.split("T")[0] }
        : { dateTime: input.startTime };
    if (input.endTime !== undefined)
      patch.end = input.allDay
        ? { date: input.endTime.split("T")[0] }
        : { dateTime: input.endTime };

    const res = await cal.events.patch({
      calendarId: input.calendarId,
      eventId: input.eventId,
      requestBody: patch,
    });
    return this.toProviderEvent(res.data);
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    const client = this.createOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth: client });
    await cal.events.delete({ calendarId, eventId });
  }

  async rsvpEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    response: string,
  ): Promise<void> {
    const client = this.createOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth: client });

    const existing = await cal.events.get({ calendarId, eventId });
    const attendees = (existing.data.attendees ?? []).map((a) =>
      a.self ? { ...a, responseStatus: response } : a,
    );

    await cal.events.patch({
      calendarId,
      eventId,
      requestBody: { attendees },
      sendUpdates: "none",
    });
  }

  async revokeToken(accessToken: string): Promise<void> {
    const client = this.createOAuth2Client();
    await client.revokeToken(accessToken).catch(() => {});
  }

  // ── Helper ──

  private toProviderEvent(item: calendar_v3.Schema$Event): ProviderEvent {
    const allDay = Boolean(item.start?.date);
    const videoEntry = item.conferenceData?.entryPoints?.find(
      (ep) => ep.entryPointType === "video",
    );
    return {
      id: item.id ?? "",
      title: item.summary ?? "Untitled",
      description: item.description ?? undefined,
      location: item.location ?? undefined,
      startTime: allDay ? item.start!.date! : (item.start?.dateTime ?? ""),
      endTime: allDay ? item.end!.date! : (item.end?.dateTime ?? ""),
      allDay,
      htmlLink: item.htmlLink ?? undefined,
      conferenceLink: videoEntry?.uri ?? item.hangoutLink ?? undefined,
      conferenceName: item.conferenceData?.conferenceSolution?.name ?? undefined,
      attendees: item.attendees?.map((a) => ({
        email: a.email ?? "",
        displayName: a.displayName ?? undefined,
        responseStatus: a.responseStatus ?? undefined,
        self: a.self ?? false,
      })),
    };
  }
}
