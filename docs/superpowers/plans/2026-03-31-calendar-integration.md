# Calendar Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full calendar support to the Slate desktop app — read/write Google Calendar events, read-only ICS feeds, with a new icon rail layout and react-big-calendar view. Designed with a provider-agnostic `CalendarProvider` interface so future providers (Outlook, CalDAV, etc.) plug in without structural changes.

**Architecture:** The backend (NestJS) acts as a proxy to external calendar APIs — no calendar events are stored in the database. Only encrypted OAuth tokens and subscription metadata are persisted. A `CalendarProvider` interface abstracts provider-specific logic (Google is the first implementation). The desktop app gets a permanent icon rail sidebar for switching between notes, chat, and calendar views with agenda/day/week/month views. Calendar data is always fetched live from providers through the backend.

**Tech Stack:** NestJS, googleapis (Google Calendar API), node-ical (ICS parsing), gRPC (proto), react-big-calendar, Prisma (token + subscription storage only), Tailwind CSS

**Security principles:**
- All OAuth tokens encrypted at rest using existing `encryption.util.ts` (AES-256-GCM)
- Every database query filters by `userId` — no endpoint can leak data across users
- OAuth flows use PKCE + state validation + minimal scopes
- Tests verify cross-user isolation on every data-access endpoint

**Implementation note:** Do NOT run git commands (commit, add, push, etc.) during implementation. The user manages git manually.

---

## Environment Variables Required

Add to `apps/core-backend/.env.example` and `apps/core-backend/.env`:

```env
# Google Calendar OAuth (required for calendar feature)
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:4000/api/calendar/oauth/callback
# Encryption key for calendar OAuth tokens at rest (AES-256-GCM via encryption.util.ts)
CALENDAR_ENCRYPTION_KEY=replace-me
```

These are separate from the user auth OIDC credentials. They use Google's OAuth 2.0 specifically for Calendar API access with the `https://www.googleapis.com/auth/calendar` scope. The `CALENDAR_ENCRYPTION_KEY` encrypts OAuth access/refresh tokens stored in Postgres, using the same AES-256-GCM pattern as `OIDC_SECRET_ENCRYPTION_KEY` (via the shared `encryption.util.ts`).

---

## File Structure

### New Files

| File                                                          | Responsibility                                          |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| `apps/core-backend/src/calendar/calendar-provider.interface.ts` | Generic `CalendarProvider` interface for extensibility |
| `apps/core-backend/src/calendar/google-calendar.provider.ts`  | Google Calendar implementation of CalendarProvider       |
| `apps/core-backend/src/calendar/calendar.module.ts`           | NestJS module wiring                                    |
| `apps/core-backend/src/calendar/calendar.service.ts`          | Provider-agnostic orchestration + connection management  |
| `apps/core-backend/src/calendar/calendar.controller.ts`       | gRPC + HTTP endpoints                                   |
| `apps/core-backend/src/calendar/ics.service.ts`               | ICS feed fetching + parsing                             |
| `apps/core-backend/test/calendar-security.e2e-spec.ts`        | Cross-user isolation + auth tests                       |
| `apps/desktop/src/components/IconRail.tsx`                    | Permanent left icon sidebar (~48px)                     |
| `apps/desktop/src/components/CalendarSidebar.tsx`             | Calendar management in left panel                       |
| `apps/desktop/src/components/CalendarView.tsx`                | react-big-calendar wrapper (agenda/day/week/month)      |
| `apps/desktop/src/components/CreateEventDialog.tsx`           | Event creation/editing dialog                           |
| `apps/desktop/src/components/AddIcsDialog.tsx`                | ICS URL subscription dialog                             |

### Modified Files

| File                                                | Changes                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/server-db/prisma/schema.prisma`           | Add `CalendarConnection`, `CalendarSubscription`, `IcsSubscription` models |
| `packages/proto/slate.proto`                        | Add `CalendarService` with messages                                        |
| `packages/shared/src/index.ts`                      | Add calendar-related types                                                 |
| `apps/core-backend/.env.example`                    | Add Google Calendar env vars                                               |
| `apps/core-backend/src/app.module.ts`               | Import `CalendarModule`                                                    |
| `apps/desktop/src/App.tsx`                          | Layout refactor: icon rail + calendar mode                                 |
| `apps/desktop/src/lib/api.ts`                       | Add calendar IPC bridge methods                                            |
| `apps/desktop/src/lib/shortcuts.ts`                 | Add `new-event` default shortcut                                           |
| `apps/desktop/src/styles/tailwind.css`              | Add calendar CSS variables + sidebar-calendar-tint                         |
| `apps/desktop/electron/main.mjs`                    | Add calendar IPC handlers                                                  |
| `apps/desktop/electron/preload.mjs`                 | Add calendar methods to context bridge                                     |
| `apps/desktop/electron/services/backend-client.mjs` | Add `calendarClient()` gRPC methods                                        |

---

## Chunk 1: Backend — Prisma Models + CalendarModule Scaffold

This chunk creates the database models for storing encrypted OAuth tokens and subscription metadata (NOT calendar events), scaffolds the NestJS module, and runs the migration. OAuth tokens are encrypted at rest using the existing `encryption.util.ts` (AES-256-GCM).

### Task 1.1: Add Prisma Models

**Files:**
- Modify: `packages/server-db/prisma/schema.prisma`

- [ ] **Step 1: Add CalendarConnection model to schema.prisma**

Append after the `Message` model at the end of the file:

```prisma
model CalendarConnection {
  id                          String   @id @default(cuid())
  userId                      String
  user                        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider                    String   @default("google")   // "google" for now — add "outlook", "caldav", etc. later
  accountIdentifier           String                         // Provider account ID (e.g. email for Google)
  accessTokenEncrypted        String   @db.Text              // AES-256-GCM via encryption.util.ts
  refreshTokenEncrypted       String   @db.Text              // AES-256-GCM via encryption.util.ts
  tokenExpiresAt              DateTime
  scopes                      String   @default("")          // Granted OAuth scopes (comma-separated)
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt
  subscriptions               CalendarSubscription[]

  @@unique([userId, provider, accountIdentifier])
  @@index([userId])
  @@map("calendar_connection")
}

model CalendarSubscription {
  id                    String   @id @default(cuid())
  userId                String
  user                  User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  connectionId          String
  connection            CalendarConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  externalCalendarId    String               // Provider calendar ID (e.g. "primary", "user@gmail.com")
  name                  String
  color                 String   @default("#7c5cdc")   // Default purple accent
  enabled               Boolean  @default(true)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@unique([userId, connectionId, externalCalendarId])
  @@index([userId])
  @@index([connectionId])
  @@map("calendar_subscription")
}

model IcsSubscription {
  id                    String   @id @default(cuid())
  userId                String
  user                  User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  url                   String
  name                  String
  color                 String   @default("#7c5cdc")
  enabled               Boolean  @default(true)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@unique([userId, url])
  @@index([userId])
  @@map("ics_subscription")
}
```

**Security note:** `accessTokenEncrypted` and `refreshTokenEncrypted` are encrypted using `encryptSecret()` from `apps/core-backend/src/ai/encryption.util.ts` with the `CALENDAR_ENCRYPTION_KEY` env var. They are **never** stored or transmitted in plaintext. The `CalendarService` decrypts them in memory only when making API calls to the provider.

- [ ] **Step 2: Add relations to User model**

In the `User` model, add these relation fields after the `documentChunks` field:

```prisma
  calendarConnections  CalendarConnection[]
  calendarSubscriptions CalendarSubscription[]
  icsSubscriptions     IcsSubscription[]
```

- [ ] **Step 3: Verify CalendarConnection has subscriptions relation**

The `CalendarConnection` model above already includes `subscriptions CalendarSubscription[]` in the schema. Verify this is present.

- [ ] **Step 4: Run Prisma migration**

Run:
```bash
cd packages/server-db && npx prisma migrate dev --name add-calendar-models
```

Expected: Migration creates `calendar_connection`, `calendar_subscription`, `ics_subscription` tables.

- [ ] **Step 5: Verify Prisma client generation**

Run:
```bash
cd packages/server-db && npx prisma generate
```

Expected: Client generated with new model types.


### Task 1.2: Add Environment Variables

**Files:**
- Modify: `apps/core-backend/.env.example`
- Modify: `apps/core-backend/.env` (if exists)

- [ ] **Step 1: Add Google Calendar env vars to .env.example**

Append to `apps/core-backend/.env.example`:

```env
# Google Calendar OAuth (required for calendar feature)
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:4000/api/calendar/oauth/callback
```


### Task 1.3: Create CalendarProvider Interface

**Files:**
- Create: `apps/core-backend/src/calendar/calendar-provider.interface.ts`

This is the provider-agnostic interface that all calendar providers implement. Google is the first implementation; Outlook, CalDAV, etc. will follow this same shape.

- [ ] **Step 1: Create calendar-provider.interface.ts**

```typescript
/**
 * Provider-agnostic interface for calendar integrations.
 *
 * Each provider (Google, Outlook, CalDAV, etc.) implements this interface.
 * The CalendarService orchestrates calls through it without provider-specific logic.
 */
export interface CalendarProviderConfig {
  /** Provider identifier (e.g. "google", "outlook") */
  providerId: string;
  /** Human-readable label */
  label: string;
  /** Whether credentials are configured on this server */
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
  accountIdentifier: string;   // email or unique account ID
  scopes: string;              // granted scopes, comma-separated
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
  startTime: string;       // ISO 8601
  endTime: string;          // ISO 8601
  allDay: boolean;
  htmlLink?: string;
}

export interface CreateEventInput {
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
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
}

export interface CalendarProvider {
  readonly providerId: string;

  /** Check if this provider's credentials are configured. */
  isConfigured(): boolean;

  /** Start the OAuth consent flow. Returns auth URL + state. */
  startOAuth(userId: string): OAuthStartResult;

  /** Complete the OAuth flow. Returns decrypted tokens (caller encrypts before storing). */
  completeOAuth(code: string, state: string): Promise<OAuthTokens>;

  /** Refresh an expired access token. Returns new tokens (caller encrypts before storing). */
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;

  /** List calendars available on the connected account. */
  listCalendars(accessToken: string): Promise<ProviderCalendar[]>;

  /** Fetch events in a date range from a specific calendar. */
  fetchEvents(accessToken: string, calendarId: string, timeMin: string, timeMax: string): Promise<ProviderEvent[]>;

  /** Create an event. */
  createEvent(accessToken: string, input: CreateEventInput): Promise<ProviderEvent>;

  /** Update an event. */
  updateEvent(accessToken: string, input: UpdateEventInput): Promise<ProviderEvent>;

  /** Delete an event. */
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;

  /** Revoke the OAuth token (best-effort). */
  revokeToken(accessToken: string): Promise<void>;
}
```

### Task 1.4: Scaffold CalendarModule

**Files:**
- Create: `apps/core-backend/src/calendar/calendar.module.ts`
- Create: `apps/core-backend/src/calendar/calendar.service.ts`
- Create: `apps/core-backend/src/calendar/calendar.controller.ts`
- Create: `apps/core-backend/src/calendar/ics.service.ts`
- Modify: `apps/core-backend/src/app.module.ts`

- [ ] **Step 1: Create calendar.module.ts**

```typescript
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { GoogleCalendarProvider } from "./google-calendar.provider";
import { IcsService } from "./ics.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CalendarController],
  providers: [CalendarService, GoogleCalendarProvider, IcsService],
  exports: [CalendarService, IcsService],
})
export class CalendarModule {}
```

- [ ] **Step 2: Create calendar.service.ts scaffold**

The service is provider-agnostic. It delegates to the appropriate `CalendarProvider` and handles token encryption/decryption.

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RpcException } from "@nestjs/microservices";
import { status as GrpcStatus } from "@grpc/grpc-js";
import { PrismaService } from "../prisma/prisma.service";
import { encryptSecret, decryptSecret } from "../ai/encryption.util";
import type { CalendarProvider } from "./calendar-provider.interface";
import { GoogleCalendarProvider } from "./google-calendar.provider";

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);
  private readonly providers: Map<string, CalendarProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly googleProvider: GoogleCalendarProvider,
  ) {
    // Register providers — add new ones here as they're implemented
    this.providers = new Map([
      ["google", this.googleProvider],
    ]);
  }

  private encryptionKey(): string {
    return this.config.get<string>("CALENDAR_ENCRYPTION_KEY", "local-dev-calendar-secret");
  }

  /** Encrypt a token before storing in Postgres. */
  private encrypt(plaintext: string): string {
    return encryptSecret(plaintext, this.encryptionKey());
  }

  /** Decrypt a token read from Postgres. */
  private decrypt(ciphertext: string): string {
    return decryptSecret(ciphertext, this.encryptionKey());
  }

  /** Get a provider by ID, or throw. */
  private getProvider(providerId: string): CalendarProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new RpcException({ code: GrpcStatus.INVALID_ARGUMENT, message: "Unknown calendar provider: " + providerId });
    }
    return provider;
  }

  /** List all configured providers. */
  getConfiguredProviders() {
    return Array.from(this.providers.entries()).map(([id, p]) => ({
      providerId: id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      configured: p.isConfigured(),
    }));
  }
}
```

- [ ] **Step 3: Create ics.service.ts scaffold**

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class IcsService {
  private readonly logger = new Logger(IcsService.name);

  constructor(private readonly prisma: PrismaService) {}
}
```

- [ ] **Step 4: Create calendar.controller.ts scaffold**

```typescript
import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { CalendarService } from "./calendar.service";
import { IcsService } from "./ics.service";

@Controller()
export class CalendarController {
  constructor(
    private readonly calendarService: CalendarService,
    private readonly icsService: IcsService,
  ) {}
}
```

- [ ] **Step 5: Register CalendarModule in app.module.ts**

Add import and add to `imports` array in `apps/core-backend/src/app.module.ts`:

```typescript
import { CalendarModule } from "./calendar/calendar.module";
```

Add `CalendarModule` to the imports array after `AiModule`.

- [ ] **Step 6: Verify backend compiles**

Run:
```bash
cd apps/core-backend && npx tsc --noEmit
```

Expected: No compilation errors.


---

## Chunk 2: Backend — Google Calendar OAuth Flow + Provider Implementation

This chunk implements GoogleCalendarProvider (the first CalendarProvider implementation), wires it into CalendarService with encrypted token storage, and adds the full gRPC/HTTP surface. After this chunk, a user can connect their Google account and store encrypted tokens.

### Task 2.1: Install googleapis dependency

**Files:**
- Modify: `apps/core-backend/package.json`

- [ ] **Step 1: Install googleapis**

Run:
```bash
cd apps/core-backend && npm install googleapis
```

### Task 2: Add Proto Definitions for CalendarService

**Files:**
- Modify: `packages/proto/slate.proto`

- [ ] **Step 1: Add calendar messages to slate.proto**

Add before the closing of the file (after the `TriggerEmbeddingResponse` message):

```protobuf
// ─── Calendar ───

message CalendarStatusRequest {}
message CalendarStatusResponse {
  repeated CalendarProviderInfo providers = 1;
  repeated CalendarConnectionInfo connections = 2;
  repeated IcsSubscriptionInfo ics_subscriptions = 3;
}

message CalendarProviderInfo {
  string provider_id = 1;
  string label = 2;
  bool configured = 3;
}

message CalendarConnectionInfo {
  string id = 1;
  string provider = 2;
  string email = 3;
  repeated CalendarInfo calendars = 4;
}

message CalendarInfo {
  string subscription_id = 1;
  string calendar_id = 2;
  string name = 3;
  string color = 4;
  bool enabled = 5;
}

message IcsSubscriptionInfo {
  string id = 1;
  string url = 2;
  string name = 3;
  string color = 4;
  bool enabled = 5;
}

message StartCalendarOAuthRequest {
  string provider_id = 1;
}
message StartCalendarOAuthResponse {
  string authorization_url = 1;
  string state = 2;
}

message CompleteCalendarOAuthRequest {
  string provider_id = 1;
  string code = 2;
  string state = 3;
}
message CompleteCalendarOAuthResponse {
  CalendarConnectionInfo connection = 1;
}

message DisconnectCalendarRequest {
  string connection_id = 1;
}

message ListGoogleCalendarsRequest {
  string connection_id = 1;
}
message ListGoogleCalendarsResponse {
  repeated AvailableCalendar calendars = 1;
}
message AvailableCalendar {
  string calendar_id = 1;
  string name = 2;
  string color = 3;
  bool is_primary = 4;
}

message SubscribeCalendarRequest {
  string connection_id = 1;
  string calendar_id = 2;
  string name = 3;
  string color = 4;
}
message SubscribeCalendarResponse {
  CalendarInfo subscription = 1;
}

message UnsubscribeCalendarRequest {
  string subscription_id = 1;
}

message UpdateCalendarSubscriptionRequest {
  string subscription_id = 1;
  optional string color = 2;
  optional bool enabled = 3;
}
message UpdateCalendarSubscriptionResponse {
  CalendarInfo subscription = 1;
}

message AddIcsSubscriptionRequest {
  string url = 1;
  string name = 2;
  optional string color = 3;
}
message AddIcsSubscriptionResponse {
  IcsSubscriptionInfo subscription = 1;
}

message RemoveIcsSubscriptionRequest {
  string id = 1;
}

message UpdateIcsSubscriptionRequest {
  string id = 1;
  optional string name = 2;
  optional string color = 3;
  optional bool enabled = 4;
}
message UpdateIcsSubscriptionResponse {
  IcsSubscriptionInfo subscription = 1;
}

message FetchCalendarEventsRequest {
  string time_min = 1;
  string time_max = 2;
}
message FetchCalendarEventsResponse {
  repeated CalendarEvent events = 1;
}
message CalendarEvent {
  string id = 1;
  string calendar_id = 2;
  string source = 3;
  string title = 4;
  optional string description = 5;
  optional string location = 6;
  string start_time = 7;
  string end_time = 8;
  bool all_day = 9;
  string color = 10;
  optional string html_link = 11;
  bool read_only = 12;
}

message CreateCalendarEventRequest {
  string subscription_id = 1;
  string title = 2;
  optional string description = 3;
  optional string location = 4;
  string start_time = 5;
  string end_time = 6;
  bool all_day = 7;
}
message CreateCalendarEventResponse {
  CalendarEvent event = 1;
}

message UpdateCalendarEventRequest {
  string subscription_id = 1;
  string event_id = 2;
  optional string title = 3;
  optional string description = 4;
  optional string location = 5;
  optional string start_time = 6;
  optional string end_time = 7;
  optional bool all_day = 8;
}
message UpdateCalendarEventResponse {
  CalendarEvent event = 1;
}

message DeleteCalendarEventRequest {
  string subscription_id = 1;
  string event_id = 2;
}

service CalendarService {
  rpc GetCalendarStatus (CalendarStatusRequest) returns (CalendarStatusResponse);
  rpc StartCalendarOAuth (StartCalendarOAuthRequest) returns (StartCalendarOAuthResponse);
  rpc CompleteCalendarOAuth (CompleteCalendarOAuthRequest) returns (CompleteCalendarOAuthResponse);
  rpc DisconnectCalendar (DisconnectCalendarRequest) returns (Empty);
  rpc ListGoogleCalendars (ListGoogleCalendarsRequest) returns (ListGoogleCalendarsResponse);
  rpc SubscribeCalendar (SubscribeCalendarRequest) returns (SubscribeCalendarResponse);
  rpc UnsubscribeCalendar (UnsubscribeCalendarRequest) returns (Empty);
  rpc UpdateCalendarSubscription (UpdateCalendarSubscriptionRequest) returns (UpdateCalendarSubscriptionResponse);
  rpc AddIcsSubscription (AddIcsSubscriptionRequest) returns (AddIcsSubscriptionResponse);
  rpc RemoveIcsSubscription (RemoveIcsSubscriptionRequest) returns (Empty);
  rpc UpdateIcsSubscription (UpdateIcsSubscriptionRequest) returns (UpdateIcsSubscriptionResponse);
  rpc FetchCalendarEvents (FetchCalendarEventsRequest) returns (FetchCalendarEventsResponse);
  rpc CreateCalendarEvent (CreateCalendarEventRequest) returns (CreateCalendarEventResponse);
  rpc UpdateCalendarEvent (UpdateCalendarEventRequest) returns (UpdateCalendarEventResponse);
  rpc DeleteCalendarEvent (DeleteCalendarEventRequest) returns (Empty);
}
```


### Task 2.3: Implement GoogleCalendarProvider

**Files:**
- Create: `apps/core-backend/src/calendar/google-calendar.provider.ts`

This is the Google-specific implementation of the `CalendarProvider` interface. It encapsulates all Google API calls. To add a new provider (e.g. Outlook), create a similar file implementing the same interface.

- [ ] **Step 1: Create GoogleCalendarProvider**

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { google, type calendar_v3 } from "googleapis";
import { randomBytes } from "node:crypto";
import type {
  CalendarProvider, OAuthStartResult, OAuthTokens,
  ProviderCalendar, ProviderEvent, CreateEventInput, UpdateEventInput,
} from "./calendar-provider.interface";

/** In-memory store for OAuth state during the consent flow (10-min expiry). */
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

  private createOAuth2Client() {
    return new google.auth.OAuth2(this.clientId(), this.clientSecret(), this.redirectUri());
  }

  // ── OAuth ──

  startOAuth(userId: string): OAuthStartResult {
    const state = randomBytes(32).toString("hex");
    oauthStateMap.set(state, { userId, createdAt: Date.now() });

    // Expire old states
    const now = Date.now();
    for (const [key, val] of oauthStateMap) {
      if (now - val.createdAt > 10 * 60 * 1000) oauthStateMap.delete(key);
    }

    const client = this.createOAuth2Client();
    const authorizationUrl = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/calendar"],
      state,
    });

    return { authorizationUrl, state };
  }

  async completeOAuth(code: string, state: string): Promise<OAuthTokens> {
    const pending = oauthStateMap.get(state);
    if (!pending) throw new Error("Invalid or expired OAuth state.");
    oauthStateMap.delete(state);

    const client = this.createOAuth2Client();
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
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600_000),
      accountIdentifier: primary.data.id ?? "unknown",
      scopes: (tokens.scope ?? "").replace(/ /g, ","),
    };
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const client = this.createOAuth2Client();
    client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await client.refreshAccessToken();

    return {
      accessToken: credentials.access_token!,
      refreshToken: credentials.refresh_token ?? refreshToken,
      expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(Date.now() + 3600_000),
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

  async fetchEvents(accessToken: string, calendarId: string, timeMin: string, timeMax: string): Promise<ProviderEvent[]> {
    const client = this.createOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth: client });

    const res = await cal.events.list({
      calendarId, timeMin, timeMax,
      singleEvents: true, orderBy: "startTime", maxResults: 500,
    });

    return (res.data.items ?? []).map((item) => this.toProviderEvent(item));
  }

  async createEvent(accessToken: string, input: CreateEventInput): Promise<ProviderEvent> {
    const client = this.createOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth: client });

    const body: calendar_v3.Schema$Event = {
      summary: input.title,
      description: input.description, location: input.location,
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
    if (input.startTime !== undefined) patch.start = input.allDay ? { date: input.startTime.split("T")[0] } : { dateTime: input.startTime };
    if (input.endTime !== undefined) patch.end = input.allDay ? { date: input.endTime.split("T")[0] } : { dateTime: input.endTime };

    const res = await cal.events.patch({ calendarId: input.calendarId, eventId: input.eventId, requestBody: patch });
    return this.toProviderEvent(res.data);
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    const client = this.createOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth: client });
    await cal.events.delete({ calendarId, eventId });
  }

  async revokeToken(accessToken: string): Promise<void> {
    const client = this.createOAuth2Client();
    await client.revokeToken(accessToken).catch(() => {});
  }

  // ── Helper ──

  private toProviderEvent(item: calendar_v3.Schema$Event): ProviderEvent {
    const allDay = Boolean(item.start?.date);
    return {
      id: item.id ?? "",
      title: item.summary ?? "Untitled",
      description: item.description ?? undefined,
      location: item.location ?? undefined,
      startTime: allDay ? item.start!.date! : (item.start?.dateTime ?? ""),
      endTime: allDay ? item.end!.date! : (item.end?.dateTime ?? ""),
      allDay,
      htmlLink: item.htmlLink ?? undefined,
    };
  }
}
```

### Task 2.3b: Implement CalendarService (provider-agnostic orchestrator)

**Files:**
- Modify: `apps/core-backend/src/calendar/calendar.service.ts`

Replace the scaffold with the full implementation. This service:
- Delegates all provider-specific API calls to the `CalendarProvider` interface
- Encrypts tokens before storing, decrypts when calling providers
- **Every query filters by `userId`** — a user can never access another user's connections/subscriptions
- Handles token refresh transparently

- [ ] **Step 1: Implement full CalendarService**

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RpcException } from "@nestjs/microservices";
import { status as GrpcStatus } from "@grpc/grpc-js";
import { PrismaService } from "../prisma/prisma.service";
import { encryptSecret, decryptSecret } from "../ai/encryption.util";
import type { CalendarProvider } from "./calendar-provider.interface";
import { GoogleCalendarProvider } from "./google-calendar.provider";

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
  }

  private encryptionKey(): string {
    return this.config.get<string>("CALENDAR_ENCRYPTION_KEY", "local-dev-calendar-secret");
  }

  private encrypt(plaintext: string): string {
    return encryptSecret(plaintext, this.encryptionKey());
  }

  private decrypt(ciphertext: string): string {
    return decryptSecret(ciphertext, this.encryptionKey());
  }

  private getProvider(providerId: string): CalendarProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new RpcException({ code: GrpcStatus.INVALID_ARGUMENT, message: `Unknown calendar provider: ${providerId}` });
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
      providerId: id, label: id.charAt(0).toUpperCase() + id.slice(1), configured: p.isConfigured(),
    }));

    return {
      providers,
      connections: connections.map((c) => ({
        id: c.id, provider: c.provider, email: c.accountIdentifier,
        calendars: c.subscriptions.map((s) => ({
          subscriptionId: s.id, calendarId: s.externalCalendarId,
          name: s.name, color: s.color, enabled: s.enabled,
        })),
      })),
      icsSubscriptions: icsSubscriptions.map((s) => ({
        id: s.id, url: s.url, name: s.name, color: s.color, enabled: s.enabled,
      })),
    };
  }

  // ── OAuth ──

  startOAuth(userId: string, providerId: string) {
    const provider = this.getProvider(providerId);
    if (!provider.isConfigured()) {
      throw new RpcException({ code: GrpcStatus.FAILED_PRECONDITION, message: `${providerId} calendar is not configured on this server.` });
    }
    return provider.startOAuth(userId);
  }

  async completeOAuth(code: string, state: string, providerId: string, userId: string) {
    const provider = this.getProvider(providerId);
    const tokens = await provider.completeOAuth(code, state);

    const connection = await this.prisma.calendarConnection.upsert({
      where: {
        userId_provider_accountIdentifier: {
          userId, provider: providerId, accountIdentifier: tokens.accountIdentifier,
        },
      },
      update: {
        accessTokenEncrypted: this.encrypt(tokens.accessToken),
        refreshTokenEncrypted: this.encrypt(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      },
      create: {
        userId, provider: providerId,
        accountIdentifier: tokens.accountIdentifier,
        accessTokenEncrypted: this.encrypt(tokens.accessToken),
        refreshTokenEncrypted: this.encrypt(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      },
      include: { subscriptions: true },
    });

    return { id: connection.id, provider: connection.provider, email: connection.accountIdentifier, calendars: [] };
  }

  // ── Connection management ──

  async disconnect(userId: string, connectionId: string) {
    const conn = await this.prisma.calendarConnection.findFirst({ where: { id: connectionId, userId } });
    if (!conn) throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "Connection not found." });

    try {
      const provider = this.getProvider(conn.provider);
      await provider.revokeToken(this.decrypt(conn.accessTokenEncrypted));
    } catch { this.logger.warn(`Failed to revoke token for connection ${connectionId}`); }

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

  async subscribe(userId: string, connectionId: string, calendarId: string, name: string, color: string) {
    await this.getConnectionForUser(userId, connectionId);
    const sub = await this.prisma.calendarSubscription.upsert({
      where: { userId_connectionId_externalCalendarId: { userId, connectionId, externalCalendarId: calendarId } },
      update: { name, color, enabled: true },
      create: { userId, connectionId, externalCalendarId: calendarId, name, color },
    });
    return { subscriptionId: sub.id, calendarId: sub.externalCalendarId, name: sub.name, color: sub.color, enabled: sub.enabled };
  }

  async unsubscribe(userId: string, subscriptionId: string) {
    const sub = await this.prisma.calendarSubscription.findFirst({ where: { id: subscriptionId, userId } });
    if (!sub) throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "Subscription not found." });
    await this.prisma.calendarSubscription.delete({ where: { id: subscriptionId } });
  }

  async updateSubscription(userId: string, subscriptionId: string, color?: string, enabled?: boolean) {
    const sub = await this.prisma.calendarSubscription.findFirst({ where: { id: subscriptionId, userId } });
    if (!sub) throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "Subscription not found." });
    const updated = await this.prisma.calendarSubscription.update({
      where: { id: subscriptionId },
      data: { ...(color !== undefined ? { color } : {}), ...(enabled !== undefined ? { enabled } : {}) },
    });
    return { subscriptionId: updated.id, calendarId: updated.externalCalendarId, name: updated.name, color: updated.color, enabled: updated.enabled };
  }

  // ── Event operations (provider-agnostic) ──

  async fetchEvents(userId: string, timeMin: string, timeMax: string) {
    const subscriptions = await this.prisma.calendarSubscription.findMany({
      where: { userId, enabled: true },
      include: { connection: true },
    });

    const events: any[] = [];
    for (const sub of subscriptions) {
      try {
        const accessToken = await this.getRefreshedAccessToken(sub.connection);
        const provider = this.getProvider(sub.connection.provider);
        const providerEvents = await provider.fetchEvents(accessToken, sub.externalCalendarId, timeMin, timeMax);
        for (const e of providerEvents) {
          events.push({
            ...e, calendarId: sub.externalCalendarId, source: sub.connection.provider,
            color: sub.color, readOnly: false,
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch events for ${sub.externalCalendarId}: ${error}`);
      }
    }
    return events;
  }

  async createEvent(userId: string, subscriptionId: string, data: { title: string; description?: string; location?: string; startTime: string; endTime: string; allDay: boolean }) {
    const sub = await this.prisma.calendarSubscription.findFirst({ where: { id: subscriptionId, userId }, include: { connection: true } });
    if (!sub) throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "Subscription not found." });
    const accessToken = await this.getRefreshedAccessToken(sub.connection);
    const provider = this.getProvider(sub.connection.provider);
    const event = await provider.createEvent(accessToken, { calendarId: sub.externalCalendarId, ...data });
    return { ...event, calendarId: sub.externalCalendarId, source: sub.connection.provider, color: sub.color, readOnly: false };
  }

  async updateEvent(userId: string, subscriptionId: string, eventId: string, data: { title?: string; description?: string; location?: string; startTime?: string; endTime?: string; allDay?: boolean }) {
    const sub = await this.prisma.calendarSubscription.findFirst({ where: { id: subscriptionId, userId }, include: { connection: true } });
    if (!sub) throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "Subscription not found." });
    const accessToken = await this.getRefreshedAccessToken(sub.connection);
    const provider = this.getProvider(sub.connection.provider);
    const event = await provider.updateEvent(accessToken, { calendarId: sub.externalCalendarId, eventId, ...data });
    return { ...event, calendarId: sub.externalCalendarId, source: sub.connection.provider, color: sub.color, readOnly: false };
  }

  async deleteEvent(userId: string, subscriptionId: string, eventId: string) {
    const sub = await this.prisma.calendarSubscription.findFirst({ where: { id: subscriptionId, userId }, include: { connection: true } });
    if (!sub) throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "Subscription not found." });
    const accessToken = await this.getRefreshedAccessToken(sub.connection);
    const provider = this.getProvider(sub.connection.provider);
    await provider.deleteEvent(accessToken, sub.externalCalendarId, eventId);
  }

  // ── Internal helpers ──

  /** Always filters by userId — prevents cross-user access. */
  private async getConnectionForUser(userId: string, connectionId: string) {
    const conn = await this.prisma.calendarConnection.findFirst({ where: { id: connectionId, userId } });
    if (!conn) throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "Connection not found." });
    return conn;
  }

  /** Decrypt access token and refresh if near expiry. Re-encrypts updated tokens. */
  private async getRefreshedAccessToken(connection: {
    id: string; provider: string;
    accessTokenEncrypted: string; refreshTokenEncrypted: string; tokenExpiresAt: Date;
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
```

- [ ] **Step 2: Verify compilation**

Run:
```bash
cd apps/core-backend && npx tsc --noEmit
```


### Task 2.4: Implement CalendarController (gRPC + HTTP callback)

**Files:**
- Modify: `apps/core-backend/src/calendar/calendar.controller.ts`

- [ ] **Step 1: Implement gRPC methods and HTTP OAuth callback**

```typescript
import { Controller, Get, Query, Res } from "@nestjs/common";
import { GrpcMethod, RpcException } from "@nestjs/microservices";
import { status as GrpcStatus } from "@grpc/grpc-js";
import type { Metadata } from "@grpc/grpc-js";
import type { Response } from "express";
import { AuthSessionService } from "../auth/auth-session.service";
import { CalendarService } from "./calendar.service";
import { IcsService } from "./ics.service";

@Controller()
export class CalendarController {
  constructor(
    private readonly calendarService: CalendarService,
    private readonly icsService: IcsService,
    private readonly authSession: AuthSessionService,
  ) {}

  // ── HTTP: OAuth callback (browser redirect landing) ──

  @Get("api/calendar/oauth/callback")
  async oauthCallback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Res() res: Response,
  ) {
    try {
      await this.calendarService.completeOAuth(code, state);
      // Close the browser window with a success message
      res.send(`
        <html><body style="background:#111;color:#fafaf9;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center">
            <h2>Google Calendar connected!</h2>
            <p style="opacity:0.6">You can close this window and return to Slate.</p>
          </div>
        </body></html>
      `);
    } catch (error: any) {
      res.status(400).send(`
        <html><body style="background:#111;color:#fafaf9;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center">
            <h2>Connection failed</h2>
            <p style="opacity:0.6">${error.message ?? "Unknown error"}</p>
          </div>
        </body></html>
      `);
    }
  }

  // ── gRPC: CalendarService ──

  @GrpcMethod("CalendarService", "GetCalendarStatus")
  async getCalendarStatus(_data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    return this.calendarService.getStatus(session.userId);
  }

  @GrpcMethod("CalendarService", "StartGoogleCalendarOAuth")
  async startCalendarOAuth(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    return this.calendarService.startOAuth(session.userId);
  }

  @GrpcMethod("CalendarService", "CompleteGoogleCalendarOAuth")
  async completeGoogleCalendarOAuth(data: any) {
    const result = await this.calendarService.completeOAuth(data.code, data.state);
    return { connection: result };
  }

  @GrpcMethod("CalendarService", "DisconnectCalendar")
  async disconnectCalendar(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    await this.calendarService.disconnect(session.userId, data.connectionId);
    return {};
  }

  @GrpcMethod("CalendarService", "ListGoogleCalendars")
  async listCalendars(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const calendars = await this.calendarService.listCalendars(session.userId, data.connectionId);
    return { calendars };
  }

  @GrpcMethod("CalendarService", "SubscribeCalendar")
  async subscribeCalendar(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const subscription = await this.calendarService.subscribe(
      session.userId, data.connectionId, data.calendarId, data.name, data.color || "#7c5cdc",
    );
    return { subscription };
  }

  @GrpcMethod("CalendarService", "UnsubscribeCalendar")
  async unsubscribeCalendar(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    await this.calendarService.unsubscribe(session.userId, data.subscriptionId);
    return {};
  }

  @GrpcMethod("CalendarService", "UpdateCalendarSubscription")
  async updateCalendarSubscription(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const subscription = await this.calendarService.updateSubscription(
      session.userId, data.subscriptionId, data.color, data.enabled,
    );
    return { subscription };
  }

  @GrpcMethod("CalendarService", "AddIcsSubscription")
  async addIcsSubscription(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const subscription = await this.icsService.addSubscription(
      session.userId, data.url, data.name, data.color || "#7c5cdc",
    );
    return { subscription };
  }

  @GrpcMethod("CalendarService", "RemoveIcsSubscription")
  async removeIcsSubscription(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    await this.icsService.removeSubscription(session.userId, data.id);
    return {};
  }

  @GrpcMethod("CalendarService", "UpdateIcsSubscription")
  async updateIcsSubscription(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const subscription = await this.icsService.updateSubscription(
      session.userId, data.id, data.name, data.color, data.enabled,
    );
    return { subscription };
  }

  @GrpcMethod("CalendarService", "FetchCalendarEvents")
  async fetchCalendarEvents(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const [googleEvents, icsEvents] = await Promise.all([
      this.calendarService.fetchGoogleEvents(session.userId, data.timeMin, data.timeMax),
      this.icsService.fetchEvents(session.userId, data.timeMin, data.timeMax),
    ]);
    return { events: [...googleEvents, ...icsEvents] };
  }

  @GrpcMethod("CalendarService", "CreateCalendarEvent")
  async createCalendarEvent(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const event = await this.calendarService.createEvent(session.userId, data.subscriptionId, {
      title: data.title,
      description: data.description,
      location: data.location,
      startTime: data.startTime,
      endTime: data.endTime,
      allDay: data.allDay ?? false,
    });
    return { event };
  }

  @GrpcMethod("CalendarService", "UpdateCalendarEvent")
  async updateCalendarEvent(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const event = await this.calendarService.updateEvent(session.userId, data.subscriptionId, data.eventId, {
      title: data.title,
      description: data.description,
      location: data.location,
      startTime: data.startTime,
      endTime: data.endTime,
      allDay: data.allDay,
    });
    return { event };
  }

  @GrpcMethod("CalendarService", "DeleteCalendarEvent")
  async deleteCalendarEvent(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    await this.calendarService.deleteEvent(session.userId, data.subscriptionId, data.eventId);
    return {};
  }
}
```


### Task 2.5: Implement ICS Service

**Files:**
- Modify: `apps/core-backend/src/calendar/ics.service.ts`

- [ ] **Step 1: Install node-ical**

Run:
```bash
cd apps/core-backend && npm install node-ical
```

Note: `node-ical` ships its own type definitions. If TypeScript cannot resolve types, add a declaration file `apps/core-backend/src/calendar/node-ical.d.ts`:
```typescript
declare module "node-ical" {
  export function async { fromURL(url: string): Promise<any> };
  export interface VEvent { type: string; uid?: string; summary?: string; description?: string; location?: string; start?: Date; end?: Date; datetype?: string; }
  export type CalendarResponse = Record<string, VEvent | any>;
}
```

- [ ] **Step 2: Implement IcsService**

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";
import { status as GrpcStatus } from "@grpc/grpc-js";
import * as ical from "node-ical";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class IcsService {
  private readonly logger = new Logger(IcsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async addSubscription(userId: string, url: string, name: string, color: string) {
    // Validate the URL is reachable and parseable
    try {
      await this.fetchAndParseIcs(url);
    } catch {
      throw new RpcException({ code: GrpcStatus.INVALID_ARGUMENT, message: "Could not fetch or parse the ICS feed. Check the URL." });
    }

    const sub = await this.prisma.icsSubscription.upsert({
      where: { userId_url: { userId, url } },
      update: { name, color, enabled: true },
      create: { userId, url, name, color, enabled: true },
    });

    return { id: sub.id, url: sub.url, name: sub.name, color: sub.color, enabled: sub.enabled };
  }

  async removeSubscription(userId: string, id: string) {
    const sub = await this.prisma.icsSubscription.findFirst({ where: { id, userId } });
    if (!sub) throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "ICS subscription not found." });
    await this.prisma.icsSubscription.delete({ where: { id } });
  }

  async updateSubscription(userId: string, id: string, name?: string, color?: string, enabled?: boolean) {
    const sub = await this.prisma.icsSubscription.findFirst({ where: { id, userId } });
    if (!sub) throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: "ICS subscription not found." });

    const updated = await this.prisma.icsSubscription.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      },
    });

    return { id: updated.id, url: updated.url, name: updated.name, color: updated.color, enabled: updated.enabled };
  }

  async fetchEvents(userId: string, timeMin: string, timeMax: string) {
    const subscriptions = await this.prisma.icsSubscription.findMany({
      where: { userId, enabled: true },
    });

    const events: any[] = [];
    const minDate = new Date(timeMin);
    const maxDate = new Date(timeMax);

    for (const sub of subscriptions) {
      try {
        const parsed = await this.fetchAndParseIcs(sub.url);
        for (const [, component] of Object.entries(parsed)) {
          if (component.type !== "VEVENT") continue;
          const vevent = component as ical.VEvent;

          const start = vevent.start ? new Date(vevent.start as unknown as string) : null;
          const end = vevent.end ? new Date(vevent.end as unknown as string) : null;
          if (!start) continue;

          // Filter by date range
          const eventEnd = end ?? start;
          if (eventEnd < minDate || start > maxDate) continue;

          const allDay = vevent.datetype === "date";

          events.push({
            id: vevent.uid ?? `ics-${sub.id}-${start.toISOString()}`,
            calendarId: sub.id,
            source: "ics",
            title: vevent.summary ?? "Untitled",
            description: vevent.description ?? undefined,
            location: vevent.location ?? undefined,
            startTime: start.toISOString(),
            endTime: eventEnd.toISOString(),
            allDay,
            color: sub.color,
            htmlLink: undefined,
            readOnly: true,
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch ICS feed ${sub.url}: ${error}`);
      }
    }

    return events;
  }

  private async fetchAndParseIcs(url: string): Promise<ical.CalendarResponse> {
    return ical.async.fromURL(url);
  }
}
```

- [ ] **Step 3: Verify compilation**

Run:
```bash
cd apps/core-backend && npx tsc --noEmit
```


### Task 2.6: Manual Test — Backend Calendar OAuth

- [ ] **Step 1: Start the backend and verify the module loads**

Run:
```bash
cd apps/core-backend && npm run start:dev
```

Expected: No startup errors, CalendarModule should register without issues. The gRPC CalendarService should appear in the logs.


---

## Chunk 3: Desktop — Electron IPC + API Bridge for Calendar

This chunk wires the desktop app's Electron main process to call the backend's CalendarService gRPC methods, and exposes them to the renderer process.

### Task 3.1: Add Calendar Client to BackendClient

**Files:**
- Modify: `apps/desktop/electron/services/backend-client.mjs`

- [ ] **Step 1: Add calendarClient() and all calendar gRPC methods**

Add after the existing `aiClient()` method and its related methods:

```javascript
  calendarClient(endpoint = this.endpoint()) {
    return new this.proto.CalendarService(endpoint, grpc.credentials.createInsecure());
  }

  async getCalendarStatus() {
    return this.unary(this.calendarClient(), "GetCalendarStatus", {}, this.currentAuthMetadata());
  }

  async startCalendarOAuth(payload) {
    return this.unary(this.calendarClient(), "StartGoogleCalendarOAuth", payload, this.currentAuthMetadata());
  }

  async completeGoogleCalendarOAuth(payload) {
    return this.unary(this.calendarClient(), "CompleteGoogleCalendarOAuth", payload);
  }

  async disconnectCalendar(payload) {
    return this.unary(this.calendarClient(), "DisconnectCalendar", payload, this.currentAuthMetadata());
  }

  async listCalendars(payload) {
    return this.unary(this.calendarClient(), "ListGoogleCalendars", payload, this.currentAuthMetadata());
  }

  async subscribeCalendar(payload) {
    return this.unary(this.calendarClient(), "SubscribeCalendar", payload, this.currentAuthMetadata());
  }

  async unsubscribeCalendar(payload) {
    return this.unary(this.calendarClient(), "UnsubscribeCalendar", payload, this.currentAuthMetadata());
  }

  async updateCalendarSubscription(payload) {
    return this.unary(this.calendarClient(), "UpdateCalendarSubscription", payload, this.currentAuthMetadata());
  }

  async addIcsSubscription(payload) {
    return this.unary(this.calendarClient(), "AddIcsSubscription", payload, this.currentAuthMetadata());
  }

  async removeIcsSubscription(payload) {
    return this.unary(this.calendarClient(), "RemoveIcsSubscription", payload, this.currentAuthMetadata());
  }

  async updateIcsSubscription(payload) {
    return this.unary(this.calendarClient(), "UpdateIcsSubscription", payload, this.currentAuthMetadata());
  }

  async fetchCalendarEvents(payload) {
    return this.unary(this.calendarClient(), "FetchCalendarEvents", payload, this.currentAuthMetadata());
  }

  async createCalendarEvent(payload) {
    return this.unary(this.calendarClient(), "CreateCalendarEvent", payload, this.currentAuthMetadata());
  }

  async updateCalendarEvent(payload) {
    return this.unary(this.calendarClient(), "UpdateCalendarEvent", payload, this.currentAuthMetadata());
  }

  async deleteCalendarEvent(payload) {
    return this.unary(this.calendarClient(), "DeleteCalendarEvent", payload, this.currentAuthMetadata());
  }
```


### Task 3.2: Add Calendar IPC Handlers to Electron Main

**Files:**
- Modify: `apps/desktop/electron/main.mjs`

- [ ] **Step 1: Register calendar IPC handlers**

Add calendar IPC handlers alongside the existing ones (after the AI-related handlers). Follow the exact same pattern used by the existing handlers (search for `ipcMain.handle` to find them):

```javascript
  ipcMain.handle("desktop:getCalendarStatus", async () => {
    return backendClient.getCalendarStatus();
  });

  ipcMain.handle("desktop:startCalendarOAuth", async (_event, payload) => {
    const result = await backendClient.startCalendarOAuth(payload);
    // Open the authorization URL in the system browser
    // Note: `shell` is already imported at the top of main.mjs from "electron"
    await shell.openExternal(result.authorizationUrl);
    return result;
  });

  ipcMain.handle("desktop:disconnectCalendar", async (_event, payload) => {
    return backendClient.disconnectCalendar(payload);
  });

  ipcMain.handle("desktop:listCalendars", async (_event, payload) => {
    return backendClient.listCalendars(payload);
  });

  ipcMain.handle("desktop:subscribeCalendar", async (_event, payload) => {
    return backendClient.subscribeCalendar(payload);
  });

  ipcMain.handle("desktop:unsubscribeCalendar", async (_event, payload) => {
    return backendClient.unsubscribeCalendar(payload);
  });

  ipcMain.handle("desktop:updateCalendarSubscription", async (_event, payload) => {
    return backendClient.updateCalendarSubscription(payload);
  });

  ipcMain.handle("desktop:addIcsSubscription", async (_event, payload) => {
    return backendClient.addIcsSubscription(payload);
  });

  ipcMain.handle("desktop:removeIcsSubscription", async (_event, payload) => {
    return backendClient.removeIcsSubscription(payload);
  });

  ipcMain.handle("desktop:updateIcsSubscription", async (_event, payload) => {
    return backendClient.updateIcsSubscription(payload);
  });

  ipcMain.handle("desktop:fetchCalendarEvents", async (_event, payload) => {
    return backendClient.fetchCalendarEvents(payload);
  });

  ipcMain.handle("desktop:createCalendarEvent", async (_event, payload) => {
    return backendClient.createCalendarEvent(payload);
  });

  ipcMain.handle("desktop:updateCalendarEvent", async (_event, payload) => {
    return backendClient.updateCalendarEvent(payload);
  });

  ipcMain.handle("desktop:deleteCalendarEvent", async (_event, payload) => {
    return backendClient.deleteCalendarEvent(payload);
  });
```

- [ ] **Step 2: Add calendar methods to preload.mjs context bridge**

In `apps/desktop/electron/preload.mjs`, add after the `triggerEmbedding` line (~line 58), before the CRDT methods. Add a `// Calendar` comment for grouping:

```javascript
  // Calendar
  getCalendarStatus: () => ipcRenderer.invoke("desktop:getCalendarStatus"),
  startCalendarOAuth: () => ipcRenderer.invoke("desktop:startCalendarOAuth"),
  disconnectCalendar: (payload) => ipcRenderer.invoke("desktop:disconnectCalendar", payload),
  listCalendars: (payload) => ipcRenderer.invoke("desktop:listCalendars", payload),
  subscribeCalendar: (payload) => ipcRenderer.invoke("desktop:subscribeCalendar", payload),
  unsubscribeCalendar: (payload) => ipcRenderer.invoke("desktop:unsubscribeCalendar", payload),
  updateCalendarSubscription: (payload) => ipcRenderer.invoke("desktop:updateCalendarSubscription", payload),
  addIcsSubscription: (payload) => ipcRenderer.invoke("desktop:addIcsSubscription", payload),
  removeIcsSubscription: (payload) => ipcRenderer.invoke("desktop:removeIcsSubscription", payload),
  updateIcsSubscription: (payload) => ipcRenderer.invoke("desktop:updateIcsSubscription", payload),
  fetchCalendarEvents: (payload) => ipcRenderer.invoke("desktop:fetchCalendarEvents", payload),
  createCalendarEvent: (payload) => ipcRenderer.invoke("desktop:createCalendarEvent", payload),
  updateCalendarEvent: (payload) => ipcRenderer.invoke("desktop:updateCalendarEvent", payload),
  deleteCalendarEvent: (payload) => ipcRenderer.invoke("desktop:deleteCalendarEvent", payload),
```

Note: All calendar methods use a single `payload` object argument (matching the DesktopApi interface), except `getCalendarStatus` and `startCalendarOAuth` which take no arguments.


### Task 3.3: Add Calendar Methods to Renderer API Bridge

**Files:**
- Modify: `apps/desktop/src/lib/api.ts`

- [ ] **Step 1: Add calendar methods to the DesktopApi interface**

In `apps/desktop/src/lib/api.ts`, add to the `DesktopApi` interface (after the `triggerEmbedding` method at ~line 128):

```typescript
  // Calendar
  getCalendarStatus(): Promise<any>;
  startCalendarOAuth(payload: { providerId: string }): Promise<any>;
  disconnectCalendar(payload: { connectionId: string }): Promise<void>;
  listCalendars(payload: { connectionId: string }): Promise<any>;
  subscribeCalendar(payload: { connectionId: string; calendarId: string; name: string; color: string }): Promise<any>;
  unsubscribeCalendar(payload: { subscriptionId: string }): Promise<void>;
  updateCalendarSubscription(payload: { subscriptionId: string; color?: string; enabled?: boolean }): Promise<any>;
  addIcsSubscription(payload: { url: string; name: string; color?: string }): Promise<any>;
  removeIcsSubscription(payload: { id: string }): Promise<void>;
  updateIcsSubscription(payload: { id: string; name?: string; color?: string; enabled?: boolean }): Promise<any>;
  fetchCalendarEvents(payload: { timeMin: string; timeMax: string }): Promise<any>;
  createCalendarEvent(payload: { subscriptionId: string; title: string; description?: string; location?: string; startTime: string; endTime: string; allDay: boolean }): Promise<any>;
  updateCalendarEvent(payload: { subscriptionId: string; eventId: string; title?: string; description?: string; location?: string; startTime?: string; endTime?: string; allDay?: boolean }): Promise<any>;
  deleteCalendarEvent(payload: { subscriptionId: string; eventId: string }): Promise<void>;
```

- [ ] **Step 2: Add calendar stubs to the browserFallback object**

In `apps/desktop/src/lib/api.ts`, add to the `browserFallback` object (after the `triggerEmbedding` stub at ~line 362):

```typescript
  // Calendar
  async getCalendarStatus() { return { providers: [], connections: [], icsSubscriptions: [] }; },
  async startCalendarOAuth() { return { authorizationUrl: '', state: '' }; },
  async disconnectCalendar() { return; },
  async listCalendars() { return { calendars: [] }; },
  async subscribeCalendar() { return { subscription: {} }; },
  async unsubscribeCalendar() { return; },
  async updateCalendarSubscription() { return { subscription: {} }; },
  async addIcsSubscription() { return { subscription: {} }; },
  async removeIcsSubscription() { return; },
  async updateIcsSubscription() { return { subscription: {} }; },
  async fetchCalendarEvents() { return { events: [] }; },
  async createCalendarEvent() { return { event: {} }; },
  async updateCalendarEvent() { return { event: {} }; },
  async deleteCalendarEvent() { return; },
```

- [ ] **Step 3: Add calendar exported functions**

Add at the end of `apps/desktop/src/lib/api.ts`, following the same `desktopApi().method()` pattern:

```typescript
// ── Calendar ──
export function getCalendarStatus() { return desktopApi().getCalendarStatus(); }
export function startCalendarOAuth(providerId: string) { return desktopApi().startCalendarOAuth({ providerId }); }
export function disconnectCalendar(connectionId: string) { return desktopApi().disconnectCalendar({ connectionId }); }
export function listCalendars(connectionId: string) { return desktopApi().listCalendars({ connectionId }); }

export function subscribeCalendar(connectionId: string, calendarId: string, name: string, color: string) { return desktopApi().subscribeCalendar({ connectionId, calendarId, name, color }); }
export function unsubscribeCalendar(subscriptionId: string) { return desktopApi().unsubscribeCalendar({ subscriptionId }); }
export function updateCalendarSubscription(subscriptionId: string, color?: string, enabled?: boolean) { return desktopApi().updateCalendarSubscription({ subscriptionId, color, enabled }); }
export function addIcsSubscription(url: string, name: string, color?: string) { return desktopApi().addIcsSubscription({ url, name, color }); }
export function removeIcsSubscription(id: string) { return desktopApi().removeIcsSubscription({ id }); }
export function updateIcsSubscription(id: string, name?: string, color?: string, enabled?: boolean) { return desktopApi().updateIcsSubscription({ id, name, color, enabled }); }
export function fetchCalendarEvents(timeMin: string, timeMax: string) { return desktopApi().fetchCalendarEvents({ timeMin, timeMax }); }
export function createCalendarEvent(subscriptionId: string, title: string, startTime: string, endTime: string, allDay: boolean, description?: string, location?: string) { return desktopApi().createCalendarEvent({ subscriptionId, title, description, location, startTime, endTime, allDay }); }
export function updateCalendarEvent(subscriptionId: string, eventId: string, title?: string, startTime?: string, endTime?: string, allDay?: boolean, description?: string, location?: string) { return desktopApi().updateCalendarEvent({ subscriptionId, eventId, title, description, location, startTime, endTime, allDay }); }
export function deleteCalendarEvent(subscriptionId: string, eventId: string) { return desktopApi().deleteCalendarEvent({ subscriptionId, eventId }); }
```


### Task 3.4: Add Shared Types for Calendar

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add calendar type exports**

Add at the end of `packages/shared/src/index.ts`:

```typescript
// ── Calendar ──

export interface CalendarConnectionInfo {
  id: string;
  provider: string;
  email: string;
  calendars: CalendarInfo[];
}

export interface CalendarInfo {
  subscriptionId: string;
  calendarId: string;
  name: string;
  color: string;
  enabled: boolean;
}

export interface IcsSubscriptionInfo {
  id: string;
  url: string;
  name: string;
  color: string;
  enabled: boolean;
}

export interface CalendarProviderInfo {
  providerId: string;
  label: string;
  configured: boolean;
}

export interface CalendarStatusResponse {
  providers: CalendarProviderInfo[];
  connections: CalendarConnectionInfo[];
  icsSubscriptions: IcsSubscriptionInfo[];
}

export interface AvailableCalendar {
  calendarId: string;
  name: string;
  color: string;
  isPrimary: boolean;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  source: "google" | "ics";
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
```


---

## Chunk 4: Desktop — Icon Rail + Layout Refactor

This chunk restructures the desktop app layout to add a permanent icon rail on the left, and updates `sidebarMode` to support three modes: notes, chat, calendar.

### Task 4.1: Add Calendar CSS Variables

**Files:**
- Modify: `apps/desktop/src/styles/tailwind.css`

- [ ] **Step 1: Add calendar-related CSS variables**

In the `:root` block, add after the existing `--sidebar-chat-tint`:

```css
  --sidebar-calendar-tint: linear-gradient(
    165deg,
    rgba(124, 92, 220, 0.10) 0%,
    rgba(180, 100, 200, 0.08) 45%,
    rgba(130, 80, 180, 0.12) 100%
  );
  --icon-rail-bg: rgba(24, 24, 24, 0.6);
  --icon-rail-width: 48px;
```

In the `@theme inline` block, add:

```css
  --color-icon-rail: var(--icon-rail-bg);
```


### Task 4.2: Create IconRail Component

**Files:**
- Create: `apps/desktop/src/components/IconRail.tsx`

- [ ] **Step 1: Build the IconRail component**

```tsx
import { Calendar, MessageSquare, StickyNote } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";

export type SidebarMode = "notes" | "chat" | "calendar";

interface IconRailProps {
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

const items: { id: SidebarMode; icon: typeof StickyNote; label: string }[] = [
  { id: "notes", icon: StickyNote, label: "Notes" },
  { id: "calendar", icon: Calendar, label: "Calendar" },
  { id: "chat", icon: MessageSquare, label: "AI Chat" },
];

export function IconRail({ mode, onModeChange, sidebarCollapsed, onToggleSidebar }: IconRailProps) {
  function handleClick(id: SidebarMode) {
    if (mode === id && !sidebarCollapsed) {
      // Clicking active mode toggles sidebar
      onToggleSidebar();
    } else {
      onModeChange(id);
    }
  }

  return (
    <nav
      className="flex h-full w-[var(--icon-rail-width)] flex-col items-center gap-1 border-r border-white/[0.04] bg-icon-rail pt-[48px] pb-2"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      aria-label="Navigation"
    >
      {items.map(({ id, icon: Icon, label }) => (
        <Tooltip key={id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex size-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 transition-colors duration-100",
                mode === id && !sidebarCollapsed
                  ? "bg-white/[0.10] text-foreground"
                  : "text-faint hover:bg-white/[0.06] hover:text-muted",
              )}
              onClick={() => handleClick(id)}
              aria-label={label}
              aria-pressed={mode === id && !sidebarCollapsed}
            >
              <Icon size={18} strokeWidth={1.6} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}
```


### Task 4.3: Refactor App.tsx Layout

**Files:**
- Modify: `apps/desktop/src/App.tsx`

This is the most complex task. Key changes:

1. Import `IconRail` and `SidebarMode` type
2. Change `sidebarMode` state from `'notes' | 'chat'` to `SidebarMode`
3. Update the grid layout to include the icon rail
4. Conditionally render editor vs calendar view in main area
5. Remove the inline chat/notes toggle buttons from the sidebar header (replaced by icon rail)
6. Update `Cmd+N` to be context-aware (note vs event)

- [ ] **Step 1: Add imports**

Add to the existing imports at the top of App.tsx:

```typescript
import { IconRail, type SidebarMode } from "./components/IconRail";
```

Import `Calendar` from lucide-react (add to the existing lucide import).

- [ ] **Step 2: Update sidebarMode state**

Change:
```typescript
const [sidebarMode, setSidebarMode] = useState<'notes' | 'chat'>('notes');
```
to:
```typescript
const [sidebarMode, setSidebarMode] = useState<SidebarMode>('notes');
```

- [ ] **Step 3: Update the grid layout CSS**

Change the `desktopShellColumns` calculation to account for the icon rail:

```typescript
const desktopShellColumns = !sidebarCollapsed && !isFloatingSidebar
  ? `var(--icon-rail-width) ${sidebarWidth}px 10px minmax(0, 1fr)`
  : `var(--icon-rail-width) 0px 0px minmax(0, 1fr)`;
```

- [ ] **Step 4: Add IconRail to the layout in the return JSX**

In the return statement, add the IconRail before the sidebar panel:

```tsx
{!isFloatingSidebar ? (
  <IconRail
    mode={sidebarMode}
    onModeChange={(mode) => {
      setSidebarMode(mode);
      if (sidebarCollapsed) setSidebarCollapsed(false);
    }}
    sidebarCollapsed={sidebarCollapsed}
    onToggleSidebar={toggleSidebar}
  />
) : null}
```

For floating sidebar mode, include the icon rail inside the floating sidebar panel.

- [ ] **Step 5: Remove inline notes/chat toggle from sidebar header**

In the `renderSidebarPanel` function, remove the `<Sparkles>` button that toggles to chat mode. The icon rail handles this now.

- [ ] **Step 6: Add calendar mode to sidebar content area**

In the `renderSidebarPanel` function's content area, add a calendar sidebar case. For now, render a placeholder:

```tsx
{sidebarMode === "calendar" ? (
  <div className="flex flex-1 flex-col items-center justify-center text-faint text-[0.85rem]">
    <Calendar size={24} className="mb-2 opacity-40" />
    Calendar panel (coming next chunk)
  </div>
) : sidebarMode === "chat" ? (
  // existing ChatSidebar
) : (
  // existing notes tree
)}
```

- [ ] **Step 7: Update grid column span for floating sidebar**

When `isFloatingSidebar` is true, the main area should span from column 2 to the end (since icon rail is column 1 only in non-floating mode, or hidden in floating mode).

Update the `main` element's style:
```tsx
style={isFloatingSidebar ? ({ gridColumn: "1 / -1" } as React.CSSProperties) : undefined}
```

When not floating, the main area is in column 4 (after icon-rail, sidebar, resizer):
The grid template handles this automatically since main is the last grid child.

- [ ] **Step 8: Update Cmd+N to be context-aware**

In the keyboard shortcuts `handleKeyDown` effect, update the `new-note` handler:

```typescript
const newNoteShortcut = getShortcut("new-note");
if (newNoteShortcut && matchesShortcut(e, newNoteShortcut)) {
  e.preventDefault();
  if (sidebarMode === "calendar") {
    // Will open event creation dialog — placeholder for now
    // setCreateEventDialogOpen(true);
  } else {
    handleCreateNote();
  }
}
```

- [ ] **Step 9: Verify the app compiles and renders**

Run:
```bash
cd apps/desktop && npm run dev
```

Expected: App launches with icon rail on the left, sidebar content toggles between notes/chat/calendar placeholder.


---

## Chunk 5: Desktop — CalendarSidebar (Left Panel)

This chunk builds the calendar management panel that shows in the left sidebar when calendar mode is active. It handles connecting Google accounts, listing/subscribing calendars, adding ICS feeds, and showing a "backend required" message.

### Task 5.1: Create CalendarSidebar Component

**Files:**
- Create: `apps/desktop/src/components/CalendarSidebar.tsx`

- [ ] **Step 1: Build the CalendarSidebar**

```tsx
import { useCallback, useEffect, useState } from "react";
import { Calendar, ChevronDown, ChevronRight, ExternalLink, Globe, Link2, Loader2, LogIn, Plus, Trash2, WifiOff } from "lucide-react";
import type { CalendarStatusResponse, CalendarConnectionInfo, IcsSubscriptionInfo, AvailableCalendar } from "@slate/shared";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "../lib/utils";
import {
  getCalendarStatus,
  startCalendarOAuth,
  disconnectCalendar,
  listCalendars,
  subscribeCalendar,
  unsubscribeCalendar,
  updateCalendarSubscription,
  addIcsSubscription,
  removeIcsSubscription,
} from "../lib/api";

interface CalendarSidebarProps {
  backendReachable: boolean;
  backendAuthenticated: boolean;
  onOpenSettings: () => void;
  onOpenAddIcs: () => void;
}

export function CalendarSidebar({
  backendReachable,
  backendAuthenticated,
  onOpenSettings,
  onOpenAddIcs,
}: CalendarSidebarProps) {
  const [status, setStatus] = useState<CalendarStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(new Set());
  const [availableCalendars, setAvailableCalendars] = useState<Record<string, AvailableCalendar[]>>({});
  const [loadingCalendars, setLoadingCalendars] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const result = await getCalendarStatus();
      setStatus(result);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (backendAuthenticated) void refresh();
    else setLoading(false);
  }, [backendAuthenticated, refresh]);

  // Poll for status changes (e.g., after OAuth in browser completes)
  // 15s interval avoids excessive backend calls while still catching OAuth completion
  useEffect(() => {
    if (!backendAuthenticated) return;
    const id = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(id);
  }, [backendAuthenticated, refresh]);

  async function handleConnectProvider(providerId: string) {
    try {
      await startCalendarOAuth(providerId);
      // Browser opens — poll will pick up the new connection
    } catch (error: any) {
      // Error toast would be nice here
    }
  }

  async function handleDisconnect(connectionId: string) {
    await disconnectCalendar(connectionId);
    await refresh();
  }

  async function toggleExpanded(connectionId: string) {
    const next = new Set(expandedConnections);
    if (next.has(connectionId)) {
      next.delete(connectionId);
    } else {
      next.add(connectionId);
      // Load available calendars if not already loaded
      if (!availableCalendars[connectionId]) {
        setLoadingCalendars((s) => new Set([...s, connectionId]));
        try {
          const cals = await listCalendars(connectionId);
          setAvailableCalendars((prev) => ({ ...prev, [connectionId]: cals.calendars }));
        } finally {
          setLoadingCalendars((s) => { const n = new Set(s); n.delete(connectionId); return n; });
        }
      }
    }
    setExpandedConnections(next);
  }

  async function handleToggleCalendar(connection: CalendarConnectionInfo, cal: AvailableCalendar) {
    const existing = connection.calendars.find((c) => c.calendarId === cal.calendarId);
    if (existing) {
      if (existing.enabled) {
        await updateCalendarSubscription(existing.subscriptionId, undefined, false);
      } else {
        await updateCalendarSubscription(existing.subscriptionId, undefined, true);
      }
    } else {
      await subscribeCalendar(connection.id, cal.calendarId, cal.name, cal.color);
    }
    await refresh();
  }

  async function handleRemoveIcs(id: string) {
    await removeIcsSubscription(id);
    await refresh();
  }

  // ── Not connected to backend ──
  if (!backendReachable || !backendAuthenticated) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-white/[0.06]">
          {!backendReachable ? <WifiOff size={18} className="text-faint" /> : <LogIn size={18} className="text-faint" />}
        </div>
        <p className="text-[0.85rem] text-muted leading-snug">
          {!backendReachable
            ? "Calendar requires a backend connection."
            : "Sign in to your backend to use calendars."}
        </p>
        <Button size="sm" variant="secondary" onClick={onOpenSettings}>
          {!backendReachable ? "Connect backend" : "Sign in"}
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={18} className="animate-spin text-faint" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="mb-1.5 flex w-full items-center justify-between text-[0.88rem] text-muted">
        <span className="text-[0.9rem] font-normal tracking-wide text-foreground" style={{ userSelect: "none" }}>
          Calendars
        </span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
                onClick={onOpenAddIcs}
                aria-label="Add ICS feed"
              >
                <Link2 size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Add ICS feed</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ScrollArea className="flex min-h-0 flex-1 flex-col [&_.ui-scroll-area__viewport]:overflow-x-hidden! [&_.ui-scroll-area__scrollbar--horizontal]:hidden">
        <div className="flex flex-col gap-3 pr-2 pb-3">
          {/* Google accounts */}
          {(status?.connections ?? []).map((conn) => (
            <div key={conn.id} className="flex flex-col gap-0.5">
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] text-foreground hover:bg-white/[0.06]"
                onClick={() => toggleExpanded(conn.id)}
              >
                {expandedConnections.has(conn.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Calendar size={13} className="text-muted" />
                <span className="min-w-0 flex-1 truncate">{conn.email}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded text-faint hover:bg-white/[0.08] hover:text-danger"
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); handleDisconnect(conn.id); }}
                      aria-label="Disconnect"
                    >
                      <Trash2 size={12} />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right">Disconnect account</TooltipContent>
                </Tooltip>
              </button>

              {expandedConnections.has(conn.id) && (
                <div className="ml-5 flex flex-col gap-0.5">
                  {loadingCalendars.has(conn.id) ? (
                    <div className="flex items-center gap-2 px-1.5 py-1 text-[0.8rem] text-faint">
                      <Loader2 size={12} className="animate-spin" /> Loading calendars...
                    </div>
                  ) : (
                    (availableCalendars[conn.id] ?? []).map((cal) => {
                      const sub = conn.calendars.find((c) => c.calendarId === cal.calendarId);
                      const enabled = sub?.enabled ?? false;
                      return (
                        <label
                          key={cal.calendarId}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[0.8rem] text-muted hover:bg-white/[0.06] hover:text-foreground"
                        >
                          <input
                            type="checkbox"
                            className="accent-[var(--accent-strong)]"
                            checked={enabled}
                            onChange={() => handleToggleCalendar(conn, cal)}
                          />
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: sub?.color ?? cal.color }}
                          />
                          <span className="min-w-0 flex-1 truncate">{cal.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          ))}

          {/* ICS feeds */}
          {(status?.icsSubscriptions ?? []).length > 0 && (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2 px-1.5 py-1 text-[0.8rem] text-faint uppercase tracking-wider">
                <Globe size={12} /> ICS Feeds
              </div>
              {(status?.icsSubscriptions ?? []).map((ics) => (
                <div key={ics.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[0.8rem] text-muted hover:bg-white/[0.06]">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: ics.color }} />
                  <span className="min-w-0 flex-1 truncate">{ics.name}</span>
                  <span
                    className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-faint hover:bg-white/[0.08] hover:text-danger"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleRemoveIcs(ics.id)}
                    aria-label="Remove ICS feed"
                  >
                    <Trash2 size={12} />
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Connect button */}
          {/* Connect buttons — one per configured provider */}
          {(status?.providers ?? []).filter((p) => p.configured).map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-dashed border-white/[0.08] bg-transparent px-2.5 py-2 text-[0.82rem] text-faint transition-colors hover:border-white/[0.14] hover:text-muted"
              onClick={() => handleConnectProvider(provider.providerId)}
            >
              <Plus size={14} />
              Connect {provider.label} Calendar
            </button>
          ))}

          {(status?.providers ?? []).every((p) => !p.configured) && (status?.connections ?? []).length === 0 && (
            <div className="px-1.5 py-2 text-[0.8rem] text-faint leading-snug">
              No calendar providers are configured on this server. Ask your admin to configure Google Calendar OAuth credentials.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
```


### Task 5.2: Create AddIcsDialog

**Files:**
- Create: `apps/desktop/src/components/AddIcsDialog.tsx`

- [ ] **Step 1: Build the dialog**

```tsx
import { useState } from "react";
import { Dialog, DialogContent } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface AddIcsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (url: string, name: string) => void;
}

export function AddIcsDialog({ open, onOpenChange, onConfirm }: AddIcsDialogProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    onConfirm(url.trim(), name.trim() || "ICS Feed");
    setUrl("");
    setName("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <h2 className="text-[1rem] font-medium text-foreground">Add ICS Feed</h2>
          <p className="text-[0.82rem] text-muted leading-snug">
            Subscribe to a read-only ICS calendar feed. Events will be fetched each time you open the calendar.
          </p>
          <div className="flex flex-col gap-2">
            <label className="text-[0.8rem] text-muted">Feed URL</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/calendar.ics"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[0.8rem] text-muted">Display name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ICS Feed"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!url.trim()}>Add feed</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```


### Task 5.3: Wire CalendarSidebar into App.tsx

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Import new components**

```typescript
import { CalendarSidebar } from "./components/CalendarSidebar";
import { AddIcsDialog } from "./components/AddIcsDialog";
```

- [ ] **Step 2: Add state for ICS dialog**

```typescript
const [addIcsOpen, setAddIcsOpen] = useState(false);
```

- [ ] **Step 3: Replace the calendar placeholder in renderSidebarPanel**

Replace the placeholder `Calendar panel (coming next chunk)` div with:

```tsx
{sidebarMode === "calendar" ? (
  <CalendarSidebar
    backendReachable={snapshot.backend.backendReachable}
    backendAuthenticated={snapshot.backend.authStatus === "authenticated"}
    onOpenSettings={() => setSettingsOpen(true)}
    onOpenAddIcs={() => setAddIcsOpen(true)}
  />
) : sidebarMode === "chat" ? (
```

- [ ] **Step 4: Add AddIcsDialog to the JSX (alongside other dialogs)**

```tsx
<AddIcsDialog
  open={addIcsOpen}
  onOpenChange={setAddIcsOpen}
  onConfirm={async (url, name) => {
    try {
      await addIcsSubscription(url, name);
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to add ICS feed");
    }
  }}
/>
```

Add the import for `addIcsSubscription` from `./lib/api`.

- [ ] **Step 5: Verify it compiles and renders**

Run: `cd apps/desktop && npm run dev`

Expected: Calendar sidebar shows in left panel when calendar icon is clicked. Shows "backend required" or "sign in" message when not connected. Shows "Connect Google Calendar" button when connected.


---

## Chunk 6: Desktop — Calendar View (Right Panel)

This chunk adds the main calendar view using react-big-calendar, displayed in the main area when calendar mode is active.

### Task 6.1: Install react-big-calendar

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Install dependencies**

Run:
```bash
cd apps/desktop && npm install react-big-calendar date-fns
npm install -D @types/react-big-calendar
```


### Task 6.2: Create CalendarView Component

**Files:**
- Create: `apps/desktop/src/components/CalendarView.tsx`

- [ ] **Step 1: Build the CalendarView component**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar as BigCalendar, dateFnsLocalizer, type View } from "react-big-calendar";
import { format, parse, startOfWeek, endOfWeek, getDay, startOfMonth, endOfMonth, startOfDay, endOfDay, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { ChevronLeft, ChevronRight, Loader2, Plus, WifiOff } from "lucide-react";
import type { CalendarEvent } from "@slate/shared";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { fetchCalendarEvents } from "../lib/api";
import "react-big-calendar/lib/css/react-big-calendar.css";

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay,
  locales: { "en-US": enUS },
});

interface CalendarViewProps {
  backendAuthenticated: boolean;
  backendReachable: boolean;
  onCreateEvent: () => void;
}

interface BigCalEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: CalendarEvent;
}

export function CalendarView({ backendAuthenticated, backendReachable, onCreateEvent }: CalendarViewProps) {
  const [view, setView] = useState<View>("month");
  const [date, setDate] = useState(new Date());
  const [events, setEvents] = useState<BigCalEvent[]>([]);
  const [loading, setLoading] = useState(false);

  /** Compute fetch range based on current view — avoids over-fetching for day/week views. */
  function getViewRange(targetDate: Date, currentView: View): { start: Date; end: Date } {
    switch (currentView) {
      case "day": return { start: subDays(startOfDay(targetDate), 1), end: addDays(endOfDay(targetDate), 1) };
      case "week": return { start: subWeeks(startOfWeek(targetDate), 1), end: addWeeks(endOfWeek(targetDate), 1) };
      case "agenda": return { start: startOfDay(targetDate), end: addMonths(targetDate, 1) };
      case "month":
      default: return { start: subMonths(startOfMonth(targetDate), 1), end: addMonths(endOfMonth(targetDate), 1) };
    }
  }

  const loadEvents = useCallback(async (targetDate: Date) => {
    if (!backendAuthenticated) return;
    setLoading(true);
    try {
      const { start: rangeStart, end: rangeEnd } = getViewRange(targetDate, view);
      const result = await fetchCalendarEvents(rangeStart.toISOString(), rangeEnd.toISOString());
      const mapped: BigCalEvent[] = (result.events ?? []).map((e: CalendarEvent) => ({
        id: e.id,
        title: e.title,
        start: new Date(e.startTime),
        end: new Date(e.endTime),
        allDay: e.allDay,
        resource: e,
      }));
      setEvents(mapped);
    } catch {
      // Silently fail — events just won't show
    } finally {
      setLoading(false);
    }
  }, [backendAuthenticated]);

  useEffect(() => {
    void loadEvents(date);
  }, [date, view, loadEvents]);

  // Refresh events every 60 seconds
  useEffect(() => {
    if (!backendAuthenticated) return;
    const id = setInterval(() => void loadEvents(date), 60_000);
    return () => clearInterval(id);
  }, [backendAuthenticated, date, loadEvents]);

  const eventStyleGetter = useCallback((event: BigCalEvent) => {
    return {
      style: {
        backgroundColor: event.resource.color ?? "rgba(124, 92, 220, 0.7)",
        border: "none",
        borderRadius: "4px",
        color: "#fafaf9",
        fontSize: "0.78rem",
        padding: "1px 4px",
      },
    };
  }, []);

  const CustomToolbar = useMemo(() => {
    return function Toolbar({ label }: { label: string }) {
      return (
        <div className="flex items-center justify-between px-4 py-2.5 [-webkit-app-region:no-drag]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-white/[0.08] hover:text-foreground"
              onClick={() => setDate((d) => {
                const next = new Date(d);
                if (view === "month") next.setMonth(next.getMonth() - 1);
                else if (view === "week") next.setDate(next.getDate() - 7);
                else next.setDate(next.getDate() - 1);
                return next;
              })}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-white/[0.08] hover:text-foreground"
              onClick={() => setDate((d) => {
                const next = new Date(d);
                if (view === "month") next.setMonth(next.getMonth() + 1);
                else if (view === "week") next.setDate(next.getDate() + 7);
                else next.setDate(next.getDate() + 1);
                return next;
              })}
            >
              <ChevronRight size={16} />
            </button>
            <span className="ml-1 text-[0.92rem] font-medium text-foreground">{label}</span>
            {loading && <Loader2 size={14} className="animate-spin text-faint ml-2" />}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="cursor-pointer rounded-md border-0 bg-transparent px-2.5 py-1 text-[0.78rem] text-muted hover:bg-white/[0.08] hover:text-foreground"
              onClick={() => setDate(new Date())}
            >
              Today
            </button>
            {(["month", "week", "day", "agenda"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                className={cn(
                  "cursor-pointer rounded-md border-0 px-2.5 py-1 text-[0.78rem] capitalize transition-colors",
                  view === v
                    ? "bg-white/[0.10] text-foreground"
                    : "bg-transparent text-muted hover:bg-white/[0.06] hover:text-foreground",
                )}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
            <Button size="sm" variant="secondary" className="ml-2 gap-1" onClick={onCreateEvent}>
              <Plus size={14} /> Event
            </Button>
          </div>
        </div>
      );
    };
  }, [view, loading, onCreateEvent]);

  if (!backendReachable || !backendAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <WifiOff size={24} className="text-faint" />
          <p className="text-[0.88rem] text-muted">
            {!backendReachable ? "Calendar requires a backend connection." : "Sign in to view your calendar."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="calendar-view flex h-full flex-col">
      <BigCalendar
        localizer={localizer}
        events={events}
        view={view}
        date={date}
        onView={setView}
        onNavigate={setDate}
        eventPropGetter={eventStyleGetter}
        components={{ toolbar: CustomToolbar }}
        popup
        style={{ flex: 1 }}
      />
    </div>
  );
}
```


### Task 6.3: Style react-big-calendar for Slate's Dark Theme

**Files:**
- Modify: `apps/desktop/src/styles/tailwind.css`

- [ ] **Step 1: Add calendar theme overrides**

Add at the end of the file:

```css
/* ── react-big-calendar dark theme overrides ── */
.calendar-view .rbc-calendar {
  font-family: var(--font-sans);
  color: var(--text);
  background: transparent;
}

.calendar-view .rbc-toolbar {
  display: none; /* We use a custom toolbar */
}

.calendar-view .rbc-header {
  border-bottom: 1px solid var(--line);
  padding: 6px 8px;
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.calendar-view .rbc-month-view,
.calendar-view .rbc-time-view {
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  overflow: hidden;
}

.calendar-view .rbc-month-row + .rbc-month-row {
  border-top: 1px solid var(--line-soft);
}

.calendar-view .rbc-day-bg {
  background: transparent;
}

.calendar-view .rbc-day-bg + .rbc-day-bg {
  border-left: 1px solid var(--line-soft);
}

.calendar-view .rbc-off-range-bg {
  background: rgba(255, 255, 255, 0.02);
}

.calendar-view .rbc-today {
  background: rgba(124, 92, 220, 0.08);
}

.calendar-view .rbc-date-cell {
  padding: 4px 6px;
  font-size: 0.78rem;
  color: var(--text-muted);
  text-align: right;
}

.calendar-view .rbc-date-cell.rbc-now {
  color: rgba(124, 92, 220, 1);
  font-weight: 600;
}

.calendar-view .rbc-event {
  border: none !important;
  outline: none !important;
}

.calendar-view .rbc-event:focus {
  outline: 1px solid rgba(124, 92, 220, 0.5) !important;
}

.calendar-view .rbc-event-label {
  font-size: 0.72rem;
  color: rgba(250, 250, 249, 0.7);
}

.calendar-view .rbc-show-more {
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 500;
}

.calendar-view .rbc-overlay {
  background: var(--panel-elevated);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  padding: 8px;
  z-index: 50;
}

.calendar-view .rbc-overlay-header {
  border-bottom: 1px solid var(--line-soft);
  padding-bottom: 4px;
  margin-bottom: 4px;
  font-size: 0.8rem;
  color: var(--text-muted);
}

/* Time view */
.calendar-view .rbc-time-header-content {
  border-left: 1px solid var(--line-soft);
}

.calendar-view .rbc-time-content {
  border-top: 1px solid var(--line-soft);
}

.calendar-view .rbc-timeslot-group {
  border-bottom: 1px solid var(--line-soft);
}

.calendar-view .rbc-time-slot {
  font-size: 0.72rem;
  color: var(--text-faint);
}

.calendar-view .rbc-day-slot .rbc-time-slot {
  border-top: 1px solid var(--line-soft);
}

.calendar-view .rbc-time-gutter .rbc-timeslot-group {
  padding-right: 8px;
  text-align: right;
}

.calendar-view .rbc-current-time-indicator {
  background-color: rgba(124, 92, 220, 0.8);
  height: 2px;
}

.calendar-view .rbc-allday-cell {
  border-bottom: 1px solid var(--line-soft);
}

.calendar-view .rbc-row-segment {
  padding: 0 2px 1px 2px;
}
```


### Task 6.4: Wire CalendarView into App.tsx Main Area

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Import CalendarView**

```typescript
import { CalendarView } from "./components/CalendarView";
```

- [ ] **Step 2: Add create event dialog state**

```typescript
const [createEventOpen, setCreateEventOpen] = useState(false);
```

- [ ] **Step 3: Conditionally render CalendarView vs Editor in main area**

In the `<main>` element, wrap the existing editor area in a condition:

```tsx
{sidebarMode === "calendar" ? (
  <CalendarView
    backendAuthenticated={snapshot.backend.authStatus === "authenticated"}
    backendReachable={snapshot.backend.backendReachable}
    onCreateEvent={() => setCreateEventOpen(true)}
  />
) : (
  /* existing editor area with SearchBar, ScrollArea, etc. */
)}
```

- [ ] **Step 4: Update main area header for calendar mode**

When in calendar mode, the top bar should show a simpler header without the note path:

```tsx
{sidebarMode === "calendar" ? (
  <div
    className="flex min-h-[48px] items-center px-6 [-webkit-app-region:drag]"
    data-electron-drag-region="true"
  >
    {renderMainHeaderControls(false)}
  </div>
) : selectedNote ? (
  /* existing note header */
) : (
  /* existing empty header */
)}
```

- [ ] **Step 5: Update Cmd+N handler**

```typescript
if (newNoteShortcut && matchesShortcut(e, newNoteShortcut)) {
  e.preventDefault();
  if (sidebarMode === "calendar") {
    setCreateEventOpen(true);
  } else {
    handleCreateNote();
  }
}
```

- [ ] **Step 6: Verify app renders with calendar view**

Run: `cd apps/desktop && npm run dev`

Expected: Clicking the calendar icon shows the BigCalendar in the main area. Month/week/day views work. Header shows navigation controls.


---

## Chunk 7: Desktop — Event Creation Dialog

This chunk adds the dialog for creating calendar events, invoked via `Cmd+N` in calendar mode or the "+ Event" button.

### Task 7.1: Create CreateEventDialog Component

**Files:**
- Create: `apps/desktop/src/components/CreateEventDialog.tsx`

- [ ] **Step 1: Build the dialog**

```tsx
import { useMemo, useState } from "react";
import { Dialog, DialogContent } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import type { CalendarInfo } from "@slate/shared";

interface CreateEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendars: CalendarInfo[];
  onConfirm: (data: {
    subscriptionId: string;
    title: string;
    description: string;
    location: string;
    startTime: string;
    endTime: string;
    allDay: boolean;
  }) => void;
}

function toLocalDateTimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toLocalDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function CreateEventDialog({ open, onOpenChange, calendars, onConfirm }: CreateEventDialogProps) {
  const now = new Date();
  const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState(toLocalDateTimeString(now));
  const [endTime, setEndTime] = useState(toLocalDateTimeString(oneHourLater));
  const [startDate, setStartDate] = useState(toLocalDateString(now));
  const [endDate, setEndDate] = useState(toLocalDateString(now));
  const [selectedCalendar, setSelectedCalendar] = useState(calendars[0]?.subscriptionId ?? "");

  const writableCalendars = useMemo(() => calendars.filter((c) => c.enabled), [calendars]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !selectedCalendar) return;

    onConfirm({
      subscriptionId: selectedCalendar,
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      startTime: allDay ? `${startDate}T00:00:00` : new Date(startTime).toISOString(),
      endTime: allDay ? `${endDate}T23:59:59` : new Date(endTime).toISOString(),
      allDay,
    });

    // Reset form
    setTitle("");
    setDescription("");
    setLocation("");
    setAllDay(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <h2 className="text-[1rem] font-medium text-foreground">New Event</h2>

          <div className="flex flex-col gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              autoFocus
              className="text-[0.95rem]"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[0.8rem] text-muted">Calendar</label>
            <select
              value={selectedCalendar}
              onChange={(e) => setSelectedCalendar(e.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[0.85rem] text-foreground outline-none focus:border-white/[0.16]"
            >
              {writableCalendars.map((cal) => (
                <option key={cal.subscriptionId} value={cal.subscriptionId}>
                  {cal.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="allDay"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="accent-[rgba(124,92,220,0.8)]"
            />
            <label htmlFor="allDay" className="cursor-pointer text-[0.82rem] text-muted">All day</label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.8rem] text-muted">Start</label>
              {allDay ? (
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[0.85rem] text-foreground outline-none"
                />
              ) : (
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[0.85rem] text-foreground outline-none"
                />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.8rem] text-muted">End</label>
              {allDay ? (
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[0.85rem] text-foreground outline-none"
                />
              ) : (
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[0.85rem] text-foreground outline-none"
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[0.8rem] text-muted">Location</label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[0.8rem] text-muted">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              rows={3}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-2 text-[0.85rem] text-foreground outline-none resize-none focus:border-white/[0.16]"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!title.trim() || !selectedCalendar}>Create event</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```


### Task 7.2: Wire CreateEventDialog into App.tsx

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Import and add state**

```typescript
import { CreateEventDialog } from "./components/CreateEventDialog";
```

Add state for tracking writable calendars:
```typescript
const [writableCalendars, setWritableCalendars] = useState<any[]>([]);
```

- [ ] **Step 2: Add effect to load writable calendars when calendar mode is active**

```typescript
useEffect(() => {
  if (sidebarMode !== "calendar" || snapshot.backend.authStatus !== "authenticated") {
    setWritableCalendars([]);
    return;
  }
  getCalendarStatus().then((status) => {
    const cals = status.connections.flatMap((conn: any) => conn.calendars.filter((c: any) => c.enabled));
    setWritableCalendars(cals);
  }).catch(() => setWritableCalendars([]));
}, [sidebarMode, snapshot.backend.authStatus]);
```

Add the import for `getCalendarStatus` from `./lib/api`.

- [ ] **Step 3: Add CreateEventDialog to the JSX**

```tsx
<CreateEventDialog
  open={createEventOpen}
  onOpenChange={setCreateEventOpen}
  calendars={writableCalendars}
  onConfirm={async (data) => {
    try {
      await createCalendarEvent(data.subscriptionId, data.title, data.startTime, data.endTime, data.allDay, data.description, data.location);
      toast.success("Event created");
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to create event");
    }
  }}
/>
```

Add the import for `createCalendarEvent` from `./lib/api`.

- [ ] **Step 4: Verify everything works end-to-end**

Run: `cd apps/desktop && npm run dev`

Expected:
- `Cmd+N` in calendar mode opens create event dialog
- `Cmd+N` in notes mode creates a note
- "+ Event" button in calendar header opens the dialog
- Calendar list shows available calendars for the event


---

## Chunk 8: Keyboard Shortcuts + Final Polish

### Task 8.1: Update Keyboard Shortcuts

**Files:**
- Modify: `apps/desktop/src/lib/shortcuts.ts`

- [ ] **Step 1: Update DEFAULT_SHORTCUTS**

The `new-note` shortcut (`mod+n`) now serves dual purpose. Update the default shortcuts and add an alias entry to clarify:

```typescript
const DEFAULT_SHORTCUTS: Record<string, string> = {
  "command-bar": "mod+p",
  "find-in-note": "mod+f",
  "new-note": "mod+n",        // Also creates event in calendar mode
  "toggle-sidebar": "mod+b",
};
```

No actual code change needed — the behavior is context-dependent in App.tsx. But document the dual-purpose nature in a comment.


### Task 8.2: Update SettingsDialog Shortcuts Section

**Files:**
- Modify: `apps/desktop/src/components/SettingsDialog.tsx`

- [ ] **Step 1: Update the shortcuts display**

In the shortcuts section of SettingsDialog, update the label for `new-note` to indicate its dual purpose:

Find the shortcuts table/list and update the `new-note` entry label from "New Note" to "New Note / Event".


### Task 8.3: Add sidebar tint for calendar mode

**Files:**
- Modify: `apps/desktop/src/styles/tailwind.css`

- [ ] **Step 1: Add sidebar-calendar-tint to existing `::after` pattern**

The existing sidebar tint system uses a `::after` pseudo-element on `.sidebar-shell` (tailwind.css ~line 286) that transitions opacity based on `data-sidebar-mode`. The chat tint is activated by `[data-sidebar-mode="chat"]::after { opacity: 1 }`.

For calendar mode, we need to:

1. Make the `::after` background conditional (currently hardcoded to `--sidebar-chat-tint`). Change the approach to use CSS custom properties controlled by the mode attribute:

After the existing `.sidebar-shell[data-sidebar-mode="chat"]::after` rule (~line 298), add:

```css
  .sidebar-shell[data-sidebar-mode="calendar"]::after {
    background: var(--sidebar-calendar-tint);
    opacity: 1;
  }
```

And add the matching resizer tint after `.sidebar-shell[data-sidebar-mode="chat"] + .sidebar-resizer::after` (~line 330):

```css
  .sidebar-shell[data-sidebar-mode="calendar"] + .sidebar-resizer::after {
    background: var(--sidebar-calendar-tint);
    opacity: 1;
  }
```

**Important:** The sidebar shell in `App.tsx` already sets `data-sidebar-mode={sidebarMode}` (see `renderSidebarPanel`), so when `sidebarMode` is `"calendar"`, this CSS will activate automatically. No additional App.tsx change needed for the tint.

This gives the calendar sidebar a subtle purple/pink tint matching the existing chat sidebar tint pattern.


---

## Chunk 9: Security Tests — Cross-User Isolation

This chunk adds e2e tests verifying that no calendar endpoint leaks data across users. These tests should be runnable against a real Postgres database (matching the existing test setup in `apps/core-backend/test/`).

### Task 9.1: Create Calendar Security E2E Tests

**Files:**
- Create: `apps/core-backend/test/calendar-security.e2e-spec.ts`

- [ ] **Step 1: Write cross-user isolation tests**

The test file should cover these scenarios. Use the existing test setup patterns from `apps/core-backend/test/` (NestJS testing module with real Prisma):

```typescript
/**
 * Calendar Security E2E Tests
 *
 * These tests verify that:
 * 1. User A cannot see User B's calendar connections
 * 2. User A cannot see User B's calendar subscriptions
 * 3. User A cannot see User B's ICS subscriptions
 * 4. User A cannot disconnect User B's calendar
 * 5. User A cannot list calendars from User B's connection
 * 6. User A cannot subscribe to calendars via User B's connection
 * 7. User A cannot unsubscribe User B's subscriptions
 * 8. User A cannot fetch events from User B's subscriptions
 * 9. User A cannot create events on User B's subscriptions
 * 10. User A cannot delete events on User B's subscriptions
 * 11. OAuth tokens are stored encrypted (not plaintext)
 */

// Test setup:
// - Create two test users (User A, User B)
// - Create a CalendarConnection for User B with encrypted tokens
// - Create a CalendarSubscription for User B
// - Create an IcsSubscription for User B
// - Verify User A cannot access any of User B's resources

// Key assertions for each endpoint:
// - getStatus(userA.id) returns empty connections (not User B's)
// - disconnect(userA.id, userB.connectionId) throws NOT_FOUND
// - listCalendars(userA.id, userB.connectionId) throws NOT_FOUND
// - subscribe(userA.id, userB.connectionId, ...) throws NOT_FOUND
// - unsubscribe(userA.id, userB.subscriptionId) throws NOT_FOUND
// - updateSubscription(userA.id, userB.subscriptionId, ...) throws NOT_FOUND
// - fetchEvents returns only User A's subscriptions' events
// - createEvent(userA.id, userB.subscriptionId, ...) throws NOT_FOUND
// - deleteEvent(userA.id, userB.subscriptionId, ...) throws NOT_FOUND

// Token encryption verification:
// - Read raw CalendarConnection from database
// - Assert accessTokenEncrypted !== plaintext access token
// - Assert refreshTokenEncrypted !== plaintext refresh token
// - Assert decryptSecret(accessTokenEncrypted, key) === original plaintext
```

The exact test implementation depends on the existing test infrastructure. Match the patterns in `apps/core-backend/test/` for module setup, database seeding, and assertions.

- [ ] **Step 2: Run the tests**

Run:
```bash
cd apps/core-backend && npm test -- --testPathPattern=calendar-security
```

Expected: All tests pass.

---

## Environment Variables Summary

All new env vars are on the **backend only** (`apps/core-backend/.env`):

| Variable                        | Required           | Description                                                                          |
| ------------------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `GOOGLE_CALENDAR_CLIENT_ID`     | Yes (for calendar) | Google Cloud OAuth 2.0 Client ID                                                     |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Yes (for calendar) | Google Cloud OAuth 2.0 Client Secret                                                 |
| `GOOGLE_CALENDAR_REDIRECT_URI`  | Optional           | OAuth callback URL (defaults to `http://localhost:4000/api/calendar/oauth/callback`) |
| `CALENDAR_ENCRYPTION_KEY`       | Yes (for calendar) | AES-256-GCM encryption key for OAuth tokens at rest                                  |

**Setup instructions for Google Cloud Console:**
1. Go to Google Cloud Console > APIs & Services > Credentials
2. Create an OAuth 2.0 Client ID (type: Web application)
3. Add authorized redirect URI: `http://localhost:4000/api/calendar/oauth/callback` (or your production URL)
4. Enable the Google Calendar API in APIs & Services > Library
5. Copy the Client ID and Client Secret to the env file
6. Generate a random `CALENDAR_ENCRYPTION_KEY` (e.g., `openssl rand -hex 32`)

---

## Testing Order

The chunks are designed to be testable in order:

1. **Chunk 1-2**: Backend compiles, migrations run, module loads → test with `npm run start:dev`
2. **Chunk 3**: Desktop IPC wiring → test with `npm run dev`, verify no errors in console
3. **Chunk 4**: Icon rail renders, sidebar modes toggle → visual test
4. **Chunk 5**: Calendar sidebar shows backend status, connect/disconnect flow → requires running backend + Google OAuth credentials
5. **Chunk 6**: Calendar view renders with events (agenda/day/week/month) → requires connected Google Calendar with events
6. **Chunk 7**: Event creation flow → requires writable calendar
7. **Chunk 8**: Shortcuts and polish → visual/behavioral test
8. **Chunk 9**: Security tests pass → run `npm test -- --testPathPattern=calendar-security`
