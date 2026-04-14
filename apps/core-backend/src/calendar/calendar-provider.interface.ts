/**
 * Provider-agnostic interface for calendar integrations.
 *
 * Each provider (Google, Outlook, CalDAV, etc.) implements this interface.
 * The CalendarService orchestrates calls through it without provider-specific logic.
 */
export interface CalendarProviderConfig {
  providerId: string;
  label: string;
  configured: boolean;
}

export interface OAuthStartResult {
  authorizationUrl: string;
  state: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  accountIdentifier: string;
  scopes: string;
}

export interface ProviderCalendar {
  calendarId: string;
  name: string;
  color: string;
  isPrimary: boolean;
}

export interface ProviderEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  htmlLink?: string;
  conferenceLink?: string;
  conferenceName?: string;
  attendees?: {
    email: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    photoUrl?: string;
  }[];
}

export interface ProviderAttendee {
  email: string;
  displayName?: string;
  personId?: string;
  photoUrl?: string;
  source: "contacts" | "otherContacts" | "directory";
}

export interface AttendeeSearchOptions {
  includeContacts: boolean;
  includeOtherContacts: boolean;
  includeDirectory: boolean;
}

export interface CreateEventInput {
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  attendees?: { email: string; displayName?: string; photoUrl?: string }[];
}

export interface UpdateEventInput {
  calendarId: string;
  eventId: string;
  title?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  attendees?: { email: string; displayName?: string; photoUrl?: string }[];
}

export interface CalendarProvider {
  readonly providerId: string;
  isConfigured(): boolean | Promise<boolean>;
  startOAuth(userId: string, redirectUri: string): OAuthStartResult | Promise<OAuthStartResult>;
  completeOAuth(code: string, state: string, redirectUri: string): Promise<OAuthTokens>;
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;
  listCalendars(accessToken: string): Promise<ProviderCalendar[]>;
  fetchEvents(
    accessToken: string,
    calendarId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<ProviderEvent[]>;
  createEvent(accessToken: string, input: CreateEventInput): Promise<ProviderEvent>;
  updateEvent(accessToken: string, input: UpdateEventInput): Promise<ProviderEvent>;
  searchAttendees(
    accessToken: string,
    query: string,
    options: AttendeeSearchOptions,
  ): Promise<ProviderAttendee[]>;
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
  rsvpEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    response: string,
  ): Promise<void>;
  revokeToken(accessToken: string): Promise<void>;
}
