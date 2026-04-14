import pino from "pino";
import type { AppConfig } from "../lib/types";
import { google, type calendar_v3 } from "googleapis";
import { people, type people_v1 } from "@googleapis/people";
import { randomBytes } from "node:crypto";
import type {
  CalendarProvider,
  OAuthStartResult,
  OAuthTokens,
  ProviderCalendar,
  ProviderEvent,
  ProviderAttendee,
  AttendeeSearchOptions,
  CreateEventInput,
  UpdateEventInput,
} from "./calendar-provider.interface";
import { SettingsService } from "../settings/settings.service";

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

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GOOGLE_CONTACTS_READ_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
const GOOGLE_OTHER_CONTACTS_READ_SCOPE = "https://www.googleapis.com/auth/contacts.other.readonly";
const GOOGLE_DIRECTORY_READ_SCOPE = "https://www.googleapis.com/auth/directory.readonly";

export const GOOGLE_ATTENDEE_SEARCH_SCOPES = [
  GOOGLE_CONTACTS_READ_SCOPE,
  GOOGLE_OTHER_CONTACTS_READ_SCOPE,
  GOOGLE_DIRECTORY_READ_SCOPE,
] as const;

export const GOOGLE_OAUTH_SCOPES = [
  GOOGLE_CALENDAR_SCOPE,
  ...GOOGLE_ATTENDEE_SEARCH_SCOPES,
] as const;

/**
 * Google Calendar implementation of CalendarProvider.
 *
 * To add another provider (Outlook, CalDAV), create a similar class
 * implementing CalendarProvider and register it in CalendarModule.
 */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly providerId = "google";
  private readonly logger = pino({ name: "GoogleCalendarProvider" });

  constructor(
    private readonly config: AppConfig,
    private readonly settings: SettingsService,
  ) {}

  // ── Config ──

  private async clientId(): Promise<string> {
    return this.settings.getGoogleCalendarClientId();
  }

  private async clientSecret(): Promise<string> {
    return this.settings.getGoogleCalendarClientSecret();
  }

  private redirectUri(): string {
    return this.config.get(
      "GOOGLE_CALENDAR_REDIRECT_URI",
      "http://localhost:4000/api/calendar/oauth/callback",
    );
  }

  async isConfigured(): Promise<boolean> {
    const [id, secret] = await Promise.all([this.clientId(), this.clientSecret()]);
    return Boolean(id && secret);
  }

  private async createOAuth2Client(redirectUri?: string) {
    const [id, secret] = await Promise.all([this.clientId(), this.clientSecret()]);
    if (!id || !secret) {
      this.logger.error(
        `OAuth2 client creation failed — clientId: ${id ? "set" : "EMPTY"}, clientSecret: ${secret ? "set" : "EMPTY"}`,
      );
    }
    return new google.auth.OAuth2(id, secret, redirectUri ?? this.redirectUri());
  }

  // ── OAuth ──

  async startOAuth(userId: string, redirectUri: string): Promise<OAuthStartResult> {
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

    const client = await this.createOAuth2Client(redirectUri);
    const authorizationUrl = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [...GOOGLE_OAUTH_SCOPES],
      state,
    });

    return { authorizationUrl, state };
  }

  async completeOAuth(code: string, state: string, redirectUri: string): Promise<OAuthTokens> {
    const pending = oauthStateMap.get(state);
    if (!pending) throw new Error("Invalid or expired OAuth state.");
    oauthStateMap.delete(state);

    const client = await this.createOAuth2Client(redirectUri);
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
    const client = await this.createOAuth2Client();
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
    const client = await this.createOAuth2Client();
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

  async searchAttendees(
    accessToken: string,
    query: string,
    options: AttendeeSearchOptions,
  ): Promise<ProviderAttendee[]> {
    const client = await this.createOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const peopleApi = people({ version: "v1", auth: client });
    const readMask = "names,emailAddresses";

    const [contactsRes, otherContactsRes, directoryRes] = await Promise.all([
      options.includeContacts
        ? peopleApi.people.searchContacts({
            query,
            readMask,
            pageSize: 10,
          }).catch((error) => {
            this.logger.warn({ err: error, query }, "Contacts search failed");
            return null;
          })
        : Promise.resolve(null),
      options.includeOtherContacts
        ? peopleApi.otherContacts.search({
            query,
            readMask,
            pageSize: 10,
          }).catch((error) => {
            this.logger.warn({ err: error, query }, "Other contacts search failed");
            return null;
          })
        : Promise.resolve(null),
      options.includeDirectory
        ? peopleApi.people
            .searchDirectoryPeople({
              query,
              readMask,
              pageSize: 25,
              sources: [
                "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE",
                "DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT",
              ],
            })
            .catch((error) => {
              this.logger.info(
                { err: error, query },
                "Directory search unavailable, falling back to contacts only",
              );
              return null;
            })
        : Promise.resolve(null),
    ]);

    const contacts = this.toProviderAttendees(
      (contactsRes?.data.results ?? []).flatMap((result) => (result.person ? [result.person] : [])),
      "contacts",
    );
    const otherContacts = this.toProviderAttendees(
      (otherContactsRes?.data.results ?? []).flatMap((result) => (result.person ? [result.person] : [])),
      "otherContacts",
    );
    const directory = this.toProviderAttendees(directoryRes?.data.people ?? [], "directory");

    return this.dedupeAttendees([...contacts, ...otherContacts, ...directory]);
  }

  // ── Events ──

  async fetchEvents(
    accessToken: string,
    calendarId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<ProviderEvent[]> {
    const client = await this.createOAuth2Client();
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
    const client = await this.createOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth: client });

    const attendees =
      input.attendees?.length
        ? input.attendees.map((attendee) => ({
            email: attendee.email,
            displayName: attendee.displayName,
          }))
        : undefined;
    const body: calendar_v3.Schema$Event = {
      summary: input.title,
      description: input.description,
      location: input.location,
      start: input.allDay ? { date: input.startTime.split("T")[0] } : { dateTime: input.startTime },
      end: input.allDay ? { date: input.endTime.split("T")[0] } : { dateTime: input.endTime },
      attendees,
    };

    const sendUpdates = attendees?.length ? "all" : undefined;
    const res = await cal.events.insert({
      calendarId: input.calendarId,
      requestBody: body,
      ...(sendUpdates ? { sendUpdates } : {}),
    });
    return this.toProviderEvent(res.data);
  }

  async updateEvent(accessToken: string, input: UpdateEventInput): Promise<ProviderEvent> {
    const client = await this.createOAuth2Client();
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
    if (input.attendees !== undefined) {
      patch.attendees = input.attendees.map((attendee) => ({
        email: attendee.email,
        displayName: attendee.displayName,
      }));
    }

    const sendUpdates = input.attendees !== undefined ? "all" : undefined;
    const res = await cal.events.patch({
      calendarId: input.calendarId,
      eventId: input.eventId,
      requestBody: patch,
      ...(sendUpdates ? { sendUpdates } : {}),
    });
    return this.toProviderEvent(res.data);
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    const client = await this.createOAuth2Client();
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
    const client = await this.createOAuth2Client();
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
    const client = await this.createOAuth2Client();
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

  private toProviderAttendees(
    peopleRecords: people_v1.Schema$Person[],
    source: ProviderAttendee["source"],
  ): ProviderAttendee[] {
    return peopleRecords.flatMap((person) => {
      const displayName = person.names?.find((name) => name.displayName)?.displayName ?? undefined;
      const personId = person.resourceName ?? undefined;
      return (person.emailAddresses ?? [])
        .map((email) => email.value?.trim())
        .filter((email): email is string => Boolean(email))
        .map((email) => ({
          email,
          displayName,
          personId,
          source,
        }));
    });
  }

  private dedupeAttendees(attendees: ProviderAttendee[]): ProviderAttendee[] {
    const byEmail = new Map<string, ProviderAttendee>();
    for (const attendee of attendees) {
      const key = attendee.email.trim().toLowerCase();
      const existing = byEmail.get(key);
      if (!existing) {
        byEmail.set(key, attendee);
        continue;
      }
      if (!existing.displayName && attendee.displayName) {
        byEmail.set(key, attendee);
      }
    }
    return Array.from(byEmail.values());
  }
}
