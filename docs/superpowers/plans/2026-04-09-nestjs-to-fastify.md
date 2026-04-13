# Fastify to Fastify Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Fastify with Fastify in the core-backend while maintaining identical API behavior, background jobs, and WebSocket collaboration. No Fastify remnants. No files >500 lines. All tests pass.

**Architecture:** Services keep their business logic unchanged — they lose Fastify decorators and accept dependencies via constructor. Fastify modules are replaced by Fastify plugins that create service instances and decorate the Fastify instance. Fastify controllers become Fastify route files. Fastify guards become Fastify preHandler hooks. The `@fastify/jwt` JwtService is replaced by `@fastify/jwt`. Pino logging is native to Fastify (replacing `fastify-pino`). pg-boss lifecycle and Hocuspocus WebSocket setup are wired via Fastify lifecycle hooks.

**Tech Stack:** Fastify 5, @fastify/jwt, @fastify/multipart, @fastify/cors, fastify-plugin, pino (native), Prisma (unchanged), pg-boss (unchanged), Hocuspocus (unchanged), LangChain (unchanged)

**Constraints:**

- No git commands during implementation
- No files >500 lines
- `auth.service.ts` (1316 lines) must be split into 3 files during migration
- All 37 existing tests must pass after migration
- AI tools (`src/ai/tools/*.ts`) are standalone functions — they don't use Fastify and need zero changes

---

## File Map

### Files to CREATE

| File                           | Purpose                                                              |
| ------------------------------ | -------------------------------------------------------------------- |
| `src/server.ts`                | Fastify app builder + startup (replaces `main.ts` + `app.module.ts`) |
| `src/plugins/prisma.ts`        | PrismaClient lifecycle as Fastify plugin                             |
| `src/plugins/auth.ts`          | JWT setup + 3 preHandler hooks (replaces 3 guards + auth module DI)  |
| `src/plugins/services.ts`      | Instantiates all services, decorates fastify instance                |
| `src/plugins/jobs.ts`          | pg-boss lifecycle + job handler registration                         |
| `src/plugins/collaboration.ts` | Hocuspocus WebSocket setup                                           |
| `src/routes/health.ts`         | `GET /api/health`                                                    |
| `src/routes/auth.ts`           | `/api/auth/*` routes                                                 |
| `src/routes/notes.ts`          | `/api/notes/*` routes                                                |
| `src/routes/attachments.ts`    | `/api/attachments/*` routes                                          |
| `src/routes/calendar.ts`       | `/api/calendar/*` routes                                             |
| `src/routes/ai.ts`             | `/api/ai/*` routes                                                   |
| `src/routes/admin.ts`          | `/internal/admin/*` routes                                           |
| `src/lib/types.ts`             | Fastify type augmentations for decorated services                    |
| `src/lib/config.ts`            | Config helper (replaces @fastify/config ConfigService)               |
| `src/lib/errors.ts`            | HTTP error helpers (replaces @fastify/common exceptions)             |

### Files to MODIFY (strip Fastify decorators, adjust dependencies)

| File                                         | Lines | Changes                                                             |
| -------------------------------------------- | ----- | ------------------------------------------------------------------- |
| `src/settings/settings.service.ts`           | 203   | Remove `@Injectable`, `OnModuleInit`, Fastify Logger, ConfigService |
| `src/auth/auth-session.service.ts`           | 48    | Remove `@Injectable`, Fastify Logger, use `@fastify/jwt` verify     |
| `src/documents/documents.service.ts`         | 319   | Remove `@Injectable`, Fastify Logger                                |
| `src/documents/crdt.service.ts`              | 174   | Remove `@Injectable`                                                |
| `src/storage/storage.service.ts`             | 113   | Remove `@Injectable`, Fastify Logger, ConfigService                 |
| `src/attachments/attachments.service.ts`     | 165   | Remove `@Injectable`, Fastify Logger                                |
| `src/calendar/calendar.service.ts`           | 494   | Remove `@Injectable`, Fastify Logger, ConfigService                 |
| `src/calendar/google-calendar.provider.ts`   | 296   | Remove `@Injectable`, Fastify Logger                                |
| `src/calendar/ics.service.ts`                | 251   | Remove `@Injectable`, Fastify Logger, ConfigService                 |
| `src/search/search.service.ts`               | 38    | Remove `@Injectable`                                                |
| `src/ai/ai-config.service.ts`                | 147   | Remove `@Injectable`, Fastify Logger, ConfigService                 |
| `src/ai/conversation.service.ts`             | 114   | Remove `@Injectable`, Fastify Logger                                |
| `src/ai/agent.service.ts`                    | 435   | Remove `@Injectable`, Fastify Logger                                |
| `src/ai/embedding.service.ts`                | 119   | Remove `@Injectable`, Fastify Logger                                |
| `src/ai/model-provider.service.ts`           | 149   | Remove `@Injectable`, Fastify Logger, ConfigService                 |
| `src/ai/chunking.service.ts`                 | 90    | Remove `@Injectable`                                                |
| `src/collaboration/collaboration.service.ts` | 90    | Remove `@Injectable`, Fastify Logger                                |
| `src/ai/encryption.util.ts`                  | —     | No changes (already standalone)                                     |

### Files to SPLIT

| Original                                | New Files                                                                                                          | Reason          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------- |
| `src/auth/auth.service.ts` (1316 lines) | `src/auth/auth.service.ts` (~350), `src/auth/auth-oidc.service.ts` (~550), `src/auth/auth-admin.service.ts` (~250) | >500 line limit |

### Files to DELETE (after migration complete)

```
src/main.ts
src/app.module.ts
src/prisma/prisma.module.ts
src/prisma/prisma.service.ts        # Replaced by plugins/prisma.ts
src/settings/settings.module.ts
src/auth/auth.module.ts
src/auth/auth.controller.ts         # Logic moves to routes/auth.ts
src/auth/http-auth.guard.ts         # Logic moves to plugins/auth.ts
src/auth/current-user.decorator.ts  # Replaced by request.user
src/notes/notes.module.ts
src/notes/notes.controller.ts       # Logic moves to routes/notes.ts
src/attachments/attachments.module.ts
src/attachments/attachments.controller.ts  # Logic moves to routes/attachments.ts
src/attachments/attachments.guard.ts       # Logic moves to plugins/auth.ts
src/calendar/calendar.module.ts
src/calendar/calendar.controller.ts        # Logic moves to routes/calendar.ts
src/search/search.module.ts
src/ai/ai.module.ts
src/ai/ai.controller.ts                   # Logic moves to routes/ai.ts
src/documents/documents.module.ts
src/internal-admin/internal-admin.module.ts
src/internal-admin/internal-admin.controller.ts  # Logic moves to routes/admin.ts
src/internal-admin/internal-admin.guard.ts       # Logic moves to plugins/auth.ts
src/collaboration/collaboration.module.ts
src/collaboration/collaboration.gateway.ts       # Logic moves to plugins/collaboration.ts
src/jobs/jobs.module.ts
```

### Files to UPDATE

| File                       | Changes                                               |
| -------------------------- | ----------------------------------------------------- |
| `package.json`             | Add fastify deps, remove Fastify deps, update scripts |
| `jest.config.ts`           | May need updates for new file locations               |
| `test/helpers/test-app.ts` | Rewrite to build Fastify app instead of Fastify app   |
| `tsconfig.build.json`      | Update if entry point changes                         |
| `Dockerfile`               | Update start command if entry point changes           |
| `Dockerfile.dev`           | Update dev command                                    |

---

## Task 1: Add Fastify Dependencies

**Files:**

- Modify: `apps/core-backend/package.json`

- [ ] **Step 1: Install Fastify packages**

Run from the repo root:

```bash
npm install --workspace @slate/core-backend fastify@5 @fastify/jwt @fastify/multipart @fastify/cors @fastify/formbody fastify-plugin pino
```

These replace: `@fastify/core`, `@fastify/common`, `@fastify/config`, `@fastify/jwt`, `@fastify/passport`, `@fastify/platform-express`, `@fastify/websockets`, `@fastify/platform-ws`, `fastify-pino`, `pino-http`. The Fastify packages stay temporarily until all migration is complete (tests still use the old test helper).

- [ ] **Step 2: Verify install succeeded**

Run: `ls node_modules/fastify/package.json`
Expected: File exists.

---

## Task 2: Create Foundation Files (Types, Config, Errors)

**Files:**

- Create: `apps/core-backend/src/lib/types.ts`
- Create: `apps/core-backend/src/lib/config.ts`
- Create: `apps/core-backend/src/lib/errors.ts`

- [ ] **Step 1: Create Fastify type augmentations**

Create `src/lib/types.ts`. This file declares what services/properties are available on the Fastify instance and request objects after plugins decorate them. Every service and preHandler that gets decorated must be declared here.

```typescript
import type { PrismaClient } from "@slate/server-db";
import type { JWT } from "@fastify/jwt";
import type { SettingsService } from "../settings/settings.service";
import type { AuthService } from "../auth/auth.service";
import type { AuthOidcService } from "../auth/auth-oidc.service";
import type { AuthAdminService } from "../auth/auth-admin.service";
import type { AuthSessionService } from "../auth/auth-session.service";
import type { DocumentsService } from "../documents/documents.service";
import type { CrdtService } from "../documents/crdt.service";
import type { StorageService } from "../storage/storage.service";
import type { AttachmentsService } from "../attachments/attachments.service";
import type { SearchService } from "../search/search.service";
import type { CalendarService } from "../calendar/calendar.service";
import type { GoogleCalendarProvider } from "../calendar/google-calendar.provider";
import type { IcsService } from "../calendar/ics.service";
import type { AiConfigService } from "../ai/ai-config.service";
import type { ConversationService } from "../ai/conversation.service";
import type { AgentService } from "../ai/agent.service";
import type { EmbeddingService } from "../ai/embedding.service";
import type { ModelProviderService } from "../ai/model-provider.service";
import type { ChunkingService } from "../ai/chunking.service";
import type { CollaborationService } from "../collaboration/collaboration.service";
import type { JobsService } from "../jobs/jobs.service";
import type { JobHandlersService } from "../jobs/job-handlers.service";

export interface UserSession {
  userId: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export interface AdminUser {
  userId: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    config: AppConfig;
    settingsService: SettingsService;
    authService: AuthService;
    authOidcService: AuthOidcService;
    authAdminService: AuthAdminService;
    authSession: AuthSessionService;
    documentsService: DocumentsService;
    crdtService: CrdtService;
    storageService: StorageService;
    attachmentsService: AttachmentsService;
    searchService: SearchService;
    calendarService: CalendarService;
    googleCalendarProvider: GoogleCalendarProvider;
    icsService: IcsService;
    aiConfigService: AiConfigService;
    conversationService: ConversationService;
    agentService: AgentService;
    embeddingService: EmbeddingService;
    modelProviderService: ModelProviderService;
    chunkingService: ChunkingService;
    collaborationService: CollaborationService;
    jobsService: JobsService;
    jobHandlers: JobHandlersService;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateAttachment: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user?: UserSession;
    adminUser?: AdminUser;
    userSession?: { userId: string };
  }
}

export interface AppConfig {
  get(key: string, defaultValue?: string): string;
}
```

- [ ] **Step 2: Create config utility**

Create `src/lib/config.ts`. This replaces `@fastify/config`'s `ConfigService`. Since `config/env.ts` already loads dotenv, this is just a thin wrapper around `process.env`.

```typescript
import type { AppConfig } from "./types";

export function createConfig(): AppConfig {
  return {
    get(key: string, defaultValue?: string): string {
      return process.env[key] ?? defaultValue ?? "";
    },
  };
}
```

- [ ] **Step 3: Create HTTP error helpers**

Create `src/lib/errors.ts`. These replace Fastify exception classes (`UnauthorizedException`, `BadRequestException`, etc.) with plain objects that Fastify's error handler understands.

```typescript
export function unauthorized(message = "Unauthorized"): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = 401;
  return err;
}

export function badRequest(message = "Bad Request"): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = 400;
  return err;
}

export function forbidden(message = "Forbidden"): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = 403;
  return err;
}

export function notFound(message = "Not Found"): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = 404;
  return err;
}

export function conflict(message = "Conflict"): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = 409;
  return err;
}
```

- [ ] **Step 4: Verify files compile**

Run: `npx tsc --noEmit --project apps/core-backend/tsconfig.json 2>&1 | head -20`
Expected: May have errors from missing service files — that's OK at this stage. The new files themselves should have no syntax errors.

---

## Task 3: Create Prisma Plugin

**Files:**

- Create: `apps/core-backend/src/plugins/prisma.ts`

- [ ] **Step 1: Create Prisma Fastify plugin**

Create `src/plugins/prisma.ts`. This replaces `prisma.module.ts` + `prisma.service.ts`. The PrismaClient is created, connected on startup, disconnected on shutdown, and decorated onto the Fastify instance.

```typescript
import fp from "fastify-plugin";
import { PrismaClient } from "@slate/server-db";
import type { FastifyInstance } from "fastify";

export default fp(async function prismaPlugin(fastify: FastifyInstance) {
  const prisma = new PrismaClient();
  await prisma.$connect();
  fastify.log.info("Prisma connected");

  fastify.decorate("prisma", prisma);

  fastify.addHook("onClose", async () => {
    await prisma.$disconnect();
    fastify.log.info("Prisma disconnected");
  });
});
```

---

## Task 4: Strip Fastify from All Services

**Files:** All service files listed in the "Files to MODIFY" table above (18 files).

This is a mechanical transformation applied to every service file. The pattern is identical for each:

**Before (Fastify):**

```typescript
import { Injectable, Logger } from "@fastify/common";
import { ConfigService } from "@fastify/config";

@Injectable()
export class SomeService implements OnModuleInit {
  private readonly logger = new Logger(SomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    /* ... */
  }
}
```

**After (Fastify):**

```typescript
import pino from "pino";
import type { AppConfig } from "../lib/config";
import type { PrismaClient } from "@slate/server-db";

export class SomeService {
  private readonly logger = pino({ name: "SomeService" });

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  async init() {
    /* was onModuleInit */
  }
}
```

**Transformation rules (apply to every service file):**

1. Remove `@Injectable()` decorator
2. Remove `implements OnModuleInit` / `implements OnModuleDestroy`
3. Replace `import { Injectable, Logger, ... } from "@fastify/common"` → remove entirely
4. Replace `import { ConfigService } from "@fastify/config"` → `import type { AppConfig } from "../lib/config"`
5. Replace `private readonly logger = new Logger(ClassName.name)` → `private readonly logger = pino({ name: "ClassName" })` and add `import pino from "pino"`
6. Replace `this.logger.log(msg)` → `this.logger.info(msg)` (Fastify Logger.log = info level)
7. Replace `this.logger.error(msg)` → `this.logger.error(msg)` (same)
8. Replace `this.logger.warn(msg)` → `this.logger.warn(msg)` (same)
9. Replace `this.logger.debug(msg)` → `this.logger.debug(msg)` (same)
10. Rename `onModuleInit()` → `init()` and `onModuleDestroy()` → `destroy()`
11. Replace `ConfigService` parameter type → `AppConfig`
12. Replace `this.config.get<string>("KEY", "default")` → `this.config.get("KEY", "default")`
13. Replace `PrismaService` type → `PrismaClient` from `@slate/server-db` (PrismaService was just PrismaClient with connect hook — no longer needed as a separate class)
14. Replace Fastify exception imports with error helpers from `src/lib/errors.ts`:
    - `throw new UnauthorizedException(msg)` → `throw unauthorized(msg)`
    - `throw new BadRequestException(msg)` → `throw badRequest(msg)`
    - `throw new ForbiddenException(msg)` → `throw forbidden(msg)`
    - `throw new NotFoundException(msg)` → `throw notFound(msg)`
    - `throw new ConflictException(msg)` → `throw conflict(msg)`

- [ ] **Step 1: Apply transformation to all 18 service files**

Apply the transformation rules above to every file in the "Files to MODIFY" table. Work through them in this order (dependency order):

1. `src/settings/settings.service.ts`
2. `src/auth/auth-session.service.ts`
3. `src/documents/crdt.service.ts`
4. `src/documents/documents.service.ts`
5. `src/storage/storage.service.ts`
6. `src/attachments/attachments.service.ts`
7. `src/search/search.service.ts`
8. `src/calendar/google-calendar.provider.ts`
9. `src/calendar/ics.service.ts`
10. `src/calendar/calendar.service.ts`
11. `src/ai/chunking.service.ts`
12. `src/ai/model-provider.service.ts`
13. `src/ai/ai-config.service.ts`
14. `src/ai/conversation.service.ts`
15. `src/ai/embedding.service.ts`
16. `src/ai/agent.service.ts`
17. `src/collaboration/collaboration.service.ts`

**Important notes per service:**

- `auth-session.service.ts`: Currently uses `JwtService` from `@fastify/jwt`. Replace with a `jwtVerify` function parameter (a callback) or accept `@fastify/jwt`'s JWT instance. Simplest: accept a `verify: (token: string) => Promise<{ sub?: string; kind?: string }>` function in the constructor.
- `settings.service.ts`: Has `onModuleInit()` that seeds default settings. Rename to `init()`.
- `jobs.service.ts` and `job-handlers.service.ts`: These already have `onModuleInit` / `onModuleDestroy`. Rename to `init()` / `destroy()`.
- `agent.service.ts` (435 lines): Under 500, keep as single file.
- `calendar.service.ts` (494 lines): Under 500, keep as single file.

- [ ] **Step 2: Verify services compile in isolation**

Run: `npx tsc --noEmit --project apps/core-backend/tsconfig.json 2>&1 | grep "error TS" | wc -l`
Expected: Errors only from files that haven't been migrated yet (controllers, modules, main.ts). Service files themselves should compile cleanly.

---

## Task 5: Split auth.service.ts

**Files:**

- Modify: `apps/core-backend/src/auth/auth.service.ts` (1316 → ~350 lines)
- Create: `apps/core-backend/src/auth/auth-oidc.service.ts` (~500 lines)
- Create: `apps/core-backend/src/auth/auth-admin.service.ts` (~250 lines)

- [ ] **Step 1: Create auth-oidc.service.ts**

Extract all OIDC-related methods into a new file. This includes:

**Public methods to move:**

- `listPublicOidcProviders()`
- `listOidcProviderConfigs()`
- `createOidcProviderConfig(payload)`
- `updateOidcProviderConfig(providerId, payload)`
- `deleteOidcProviderConfig(providerIdRaw)`
- `startOidc(providerId, redirectUri, clientId, isAdmin?)`
- `completeOidc(payload)`
- `startAdminOidc(providerId, redirectUri)`
- `completeAdminOidc(payload)`
- `countEnabledOidcProviders()`
- `countAdminsWithOidcLogins()`

**Private methods to move:**

- `completeOidcFlow(payload)`
- `resolveOidcIdentity(payload)`
- `createOidcAccount(email, displayNameRaw)`
- `getEnabledProvider(providerId)`
- `resolveOidcProviderById(providerId, isAdmin?)`
- `getOidcMetadata(issuerUrl)`
- `exchangeToken(payload)`
- `normalizeProviderId(providerIdRaw)`
- `normalizeIssuerUrl(issuerRaw)`
- `normalizeScopes(scopesRaw?)`
- `getSecretKey()`
- `encryptSecret(secret)`
- `decryptSecret(encoded)`
- `base64Url(bytes)`
- `assertCanDisablePasswordAuth()`
- `assertProviderCanBeDisabledOrDeleted(providerId)`

**Also move:**

- `OidcMetadata`, `OidcTokenResponse`, `OidcProviderConfigRecord` types
- The `oidcMetadataCache` field

Constructor dependencies: `prisma: PrismaClient`, `settingsService: SettingsService`, `config: AppConfig`, and a `jwtSign` function for issuing tokens (so it can call `issueTokens` logic). Or accept `authService` as a dependency for `issueTokens()`. Simplest: accept a `issueTokens: (userId: string) => { accessToken, refreshToken }` callback.

- [ ] **Step 2: Create auth-admin.service.ts**

Extract admin-specific methods:

**Public methods to move:**

- `authenticateAdmin(email, password)`
- `createInternalAdminSession(payload)`
- `verifyInternalAdminToken(token)`
- `setupInitialAdmin(payload)`
- `userCount()`
- `upsertAdminManagedUser(userId?, payload)`

**Private methods to move:**

- `createInternalAdminSessionForUser(user)`
- `assertCanChangeAdminRole(userId, nextIsAdmin)`

Constructor dependencies: `prisma: PrismaClient`, `config: AppConfig`, `jwtSign: (payload, options?) => string`, `jwtVerify: (token) => Promise<any>`

- [ ] **Step 3: Update auth.service.ts**

What remains (~350 lines):

- `listProviders()` (calls authOidcService.listPublicOidcProviders)
- `loginWithPassword(payload)`
- `registerWithPassword(payload)`
- `createPasswordAccount(payload)`
- `refreshTokens(refreshToken)`
- `getCurrentSession(session)`
- `normalizeUsername(displayName)`
- `validateRegistrationPayload(payload)`
- `accountCreationEnabled()`
- `passwordAuthEnabled()`
- `updatePasswordAuthEnabled(enabled)`
- `ensurePasswordAuthEnabled()` (private)
- `issueTokens(userId)` (private, used by auth.service + passed to oidc/admin)

Constructor: `prisma: PrismaClient`, `config: AppConfig`, `settingsService: SettingsService`, `jwtSign: (payload: object, options?: object) => string`

Apply the same Fastify stripping rules from Task 4 during the split.

- [ ] **Step 4: Verify all 3 auth files compile**

Run: `npx tsc --noEmit --project apps/core-backend/tsconfig.json 2>&1 | grep "auth" | head -20`
Expected: No errors from the auth service files.

---

## Task 6: Create Auth Plugin

**Files:**

- Create: `apps/core-backend/src/plugins/auth.ts`

- [ ] **Step 1: Create auth plugin with JWT + preHandlers**

Create `src/plugins/auth.ts`. This replaces `auth.module.ts`, `http-auth.guard.ts`, `attachments.guard.ts`, `internal-admin.guard.ts`, and `current-user.decorator.ts`.

```typescript
import fp from "fastify-plugin";
import fjwt from "@fastify/jwt";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { AuthSessionService } from "../auth/auth-session.service";
import { unauthorized } from "../lib/errors";

export default fp(async function authPlugin(fastify: FastifyInstance) {
  // Register @fastify/jwt
  await fastify.register(fjwt, {
    secret: fastify.config.get("JWT_SECRET", "local-dev-secret"),
  });

  // Create auth session service with JWT verify function
  const authSession = new AuthSessionService(fastify.prisma, async (token: string) =>
    fastify.jwt.verify(token),
  );
  fastify.decorate("authSession", authSession);

  // preHandler: authenticate regular users (replaces HttpAuthGuard)
  fastify.decorate("authenticate", async function (request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization;
    if (typeof header !== "string") throw unauthorized("Missing authorization token");
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) throw unauthorized("Missing authorization token");
    try {
      request.user = await authSession.validateAccessToken(match[1]);
    } catch {
      throw unauthorized("Invalid or expired token");
    }
  });

  // preHandler: authenticate admin users (replaces InternalAdminGuard)
  fastify.decorate(
    "authenticateAdmin",
    async function (request: FastifyRequest, reply: FastifyReply) {
      const header = request.headers.authorization;
      if (!header) throw unauthorized("Missing admin authorization token");
      const match = header.match(/^Bearer\s+(.+)$/i);
      if (!match) throw unauthorized("Missing admin authorization token");
      const adminUser = await fastify.authAdminService.verifyInternalAdminToken(match[1]);
      request.adminUser = adminUser;
    },
  );

  // preHandler: authenticate attachment access (replaces AttachmentsGuard)
  // Supports both Bearer header and ?token= query param (for <img src> tags)
  fastify.decorate(
    "authenticateAttachment",
    async function (request: FastifyRequest, reply: FastifyReply) {
      let token: string | null = null;

      const header = request.headers.authorization;
      if (header) {
        const match = header.match(/^Bearer\s+(.+)$/i);
        if (match) token = match[1];
      }

      if (!token) {
        const queryToken = (request.query as Record<string, unknown>)?.token;
        if (typeof queryToken === "string" && queryToken.length > 0) token = queryToken;
      }

      if (!token) throw unauthorized("Missing authorization token");

      let payload: { sub?: string; kind?: string };
      try {
        payload = fastify.jwt.verify(token);
      } catch {
        throw unauthorized("Invalid or expired session");
      }

      if (!payload?.sub || payload.kind === "refresh") {
        throw unauthorized("Invalid session payload");
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true },
      });
      if (!user) throw unauthorized("Session is no longer valid");

      request.userSession = { userId: payload.sub };
    },
  );
});
```

---

## Task 7: Create Services Plugin

**Files:**

- Create: `apps/core-backend/src/plugins/services.ts`

- [ ] **Step 1: Create services plugin**

Create `src/plugins/services.ts`. This instantiates all services with their dependencies and decorates them onto the Fastify instance. It also calls `init()` on services that need startup initialization (formerly `onModuleInit`).

```typescript
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

import { SettingsService } from "../settings/settings.service";
import { AuthService } from "../auth/auth.service";
import { AuthOidcService } from "../auth/auth-oidc.service";
import { AuthAdminService } from "../auth/auth-admin.service";
import { DocumentsService } from "../documents/documents.service";
import { CrdtService } from "../documents/crdt.service";
import { StorageService } from "../storage/storage.service";
import { AttachmentsService } from "../attachments/attachments.service";
import { SearchService } from "../search/search.service";
import { CalendarService } from "../calendar/calendar.service";
import { GoogleCalendarProvider } from "../calendar/google-calendar.provider";
import { IcsService } from "../calendar/ics.service";
import { AiConfigService } from "../ai/ai-config.service";
import { ConversationService } from "../ai/conversation.service";
import { AgentService } from "../ai/agent.service";
import { EmbeddingService } from "../ai/embedding.service";
import { ModelProviderService } from "../ai/model-provider.service";
import { ChunkingService } from "../ai/chunking.service";
import { CollaborationService } from "../collaboration/collaboration.service";

export default fp(async function servicesPlugin(fastify: FastifyInstance) {
  const { prisma, config } = fastify;

  // JWT helpers for services that need to sign/verify tokens
  const jwtSign = (payload: object, options?: object) => fastify.jwt.sign(payload, options);
  const jwtVerify = (token: string) => fastify.jwt.verify(token);

  // Core services
  const settingsService = new SettingsService(prisma, config);
  await settingsService.init();
  fastify.decorate("settingsService", settingsService);

  // Auth services
  const authService = new AuthService(prisma, config, settingsService, jwtSign);
  fastify.decorate("authService", authService);

  const issueTokensFn = authService.issueTokens.bind(authService);
  const authOidcService = new AuthOidcService(
    prisma,
    config,
    settingsService,
    jwtSign,
    issueTokensFn,
  );
  fastify.decorate("authOidcService", authOidcService);

  const authAdminService = new AuthAdminService(prisma, config, jwtSign, jwtVerify);
  fastify.decorate("authAdminService", authAdminService);

  // Document services
  const crdtService = new CrdtService();
  fastify.decorate("crdtService", crdtService);

  const documentsService = new DocumentsService(prisma, crdtService);
  fastify.decorate("documentsService", documentsService);

  // Storage
  const storageService = new StorageService(settingsService, config);
  fastify.decorate("storageService", storageService);

  const attachmentsService = new AttachmentsService(prisma, storageService);
  fastify.decorate("attachmentsService", attachmentsService);

  // Search
  const searchService = new SearchService(prisma);
  fastify.decorate("searchService", searchService);

  // Calendar
  const googleCalendarProvider = new GoogleCalendarProvider(prisma, settingsService, config);
  fastify.decorate("googleCalendarProvider", googleCalendarProvider);

  const icsService = new IcsService(prisma, config);
  fastify.decorate("icsService", icsService);

  const calendarService = new CalendarService(
    prisma,
    settingsService,
    googleCalendarProvider,
    icsService,
    config,
  );
  fastify.decorate("calendarService", calendarService);

  // AI
  const chunkingService = new ChunkingService();
  fastify.decorate("chunkingService", chunkingService);

  const modelProviderService = new ModelProviderService(config);
  fastify.decorate("modelProviderService", modelProviderService);

  const aiConfigService = new AiConfigService(prisma, config);
  fastify.decorate("aiConfigService", aiConfigService);

  const conversationService = new ConversationService(prisma);
  fastify.decorate("conversationService", conversationService);

  const embeddingService = new EmbeddingService(prisma, chunkingService, modelProviderService);
  fastify.decorate("embeddingService", embeddingService);

  const agentService = new AgentService(
    prisma,
    modelProviderService,
    conversationService,
    searchService,
    documentsService,
    crdtService,
    calendarService,
    icsService,
    embeddingService,
  );
  fastify.decorate("agentService", agentService);

  // Collaboration
  const collaborationService = new CollaborationService(prisma, crdtService);
  fastify.decorate("collaborationService", collaborationService);
});
```

**Note:** The exact constructor signatures depend on the refactored service files from Tasks 4-5. Adjust parameter order and types to match what each service actually needs after Fastify stripping. Read each service's constructor before wiring.

---

## Task 8: Create Jobs Plugin

**Files:**

- Create: `apps/core-backend/src/plugins/jobs.ts`

- [ ] **Step 1: Create jobs plugin**

Create `src/plugins/jobs.ts`. This replaces `jobs.module.ts`. It creates the JobsService and JobHandlersService, starts pg-boss, registers workers and schedules, and handles shutdown.

```typescript
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { JobsService } from "../jobs/jobs.service";
import { JobHandlersService } from "../jobs/job-handlers.service";

export default fp(async function jobsPlugin(fastify: FastifyInstance) {
  const jobsService = new JobsService(fastify.config);
  fastify.decorate("jobsService", jobsService);

  const jobHandlers = new JobHandlersService(
    jobsService,
    fastify.prisma,
    fastify.storageService,
    fastify.embeddingService,
    fastify.config,
  );
  fastify.decorate("jobHandlers", jobHandlers);

  // Register workers and schedules (was onModuleInit)
  await jobHandlers.init();

  fastify.addHook("onClose", async () => {
    await jobsService.destroy();
  });
});
```

---

## Task 9: Create Collaboration Plugin

**Files:**

- Create: `apps/core-backend/src/plugins/collaboration.ts`

- [ ] **Step 1: Create collaboration plugin**

Create `src/plugins/collaboration.ts`. This replaces `collaboration.module.ts` + `collaboration.gateway.ts`. It creates the Hocuspocus server and wires the HTTP upgrade handler.

```typescript
import fp from "fastify-plugin";
import { Hocuspocus } from "@hocuspocus/server";
import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "http";
import { WebSocketServer } from "ws";

export default fp(async function collaborationPlugin(fastify: FastifyInstance) {
  const { authSession, collaborationService } = fastify;
  const log = fastify.log.child({ name: "Collaboration" });

  const hocuspocus = new Hocuspocus({
    name: "slate-collaboration",
    timeout: 30000,
    debounce: 2000,
    maxDebounce: 10000,

    async onAuthenticate(data) {
      const token = data.token;
      log.info(`[auth] token present: ${!!token}, length: ${token?.length ?? 0}`);
      if (!token) throw new Error("No authentication token provided");
      try {
        const session = await authSession.validateAccessToken(token);
        log.info(`[auth] authenticated userId=${session.userId}`);
        return { userId: session.userId };
      } catch (err) {
        log.error(`[auth] failed: ${err}`);
        throw err;
      }
    },

    async onLoadDocument(data) {
      const context = data.context as { userId: string };
      log.info(`[load] doc=${data.documentName} userId=${context.userId}`);
      await collaborationService.handleLoadDocument(
        data.document,
        data.documentName,
        context.userId,
      );
    },

    async onStoreDocument(data) {
      const context = data.context as { userId: string };
      const path = (data.document.getMap("meta").get("path") as string) || data.documentName;
      log.info(`[store] doc=${data.documentName} userId=${context.userId} path=${path}`);
      await collaborationService.handleStoreDocument(
        data.document,
        data.documentName,
        context.userId,
        path,
      );
    },

    async onConnect(data) {
      log.info(`[connect] doc=${data.documentName} clients=${data.instance.getConnectionsCount()}`);
    },

    async onDisconnect(data) {
      log.info(
        `[disconnect] doc=${data.documentName} clients=${data.instance.getConnectionsCount()}`,
      );
    },
  });

  log.info("Hocuspocus collaboration server configured");

  // Wire WebSocket upgrades on /collaboration
  const wss = new WebSocketServer({ noServer: true });

  fastify.addHook("onReady", async () => {
    const httpServer = fastify.server;
    httpServer.on("upgrade", (request: IncomingMessage, socket: any, head: any) => {
      if (request.url?.startsWith("/collaboration")) {
        wss.handleUpgrade(request, socket, head, (ws: any) => {
          hocuspocus.handleConnection(ws, request);
        });
      } else {
        socket.destroy();
      }
    });
  });

  fastify.addHook("onClose", async () => {
    await hocuspocus.closeConnections();
  });
});
```

---

## Task 10: Create Route Files

**Files:**

- Create: `apps/core-backend/src/routes/health.ts`
- Create: `apps/core-backend/src/routes/auth.ts`
- Create: `apps/core-backend/src/routes/notes.ts`
- Create: `apps/core-backend/src/routes/attachments.ts`
- Create: `apps/core-backend/src/routes/calendar.ts`
- Create: `apps/core-backend/src/routes/ai.ts`
- Create: `apps/core-backend/src/routes/admin.ts`

Each route file follows this pattern, converting Fastify controller decorators to Fastify route registrations:

**Fastify pattern:**

```typescript
@Controller()
export class SomeController {
  @Get("api/thing")
  @UseGuards(HttpAuthGuard)
  async getThing(@CurrentUser() user: Session) {
    return this.service.get(user.userId);
  }
}
```

**Fastify pattern:**

```typescript
export default async function someRoutes(fastify: FastifyInstance) {
  fastify.get("/api/thing", { preHandler: [fastify.authenticate] }, async (request) => {
    return fastify.someService.get(request.user!.userId);
  });
}
```

- [ ] **Step 1: Create health route**

Create `src/routes/health.ts`:

```typescript
import type { FastifyInstance } from "fastify";

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/api/health", async () => ({ ok: true }));
}
```

- [ ] **Step 2: Create auth routes**

Create `src/routes/auth.ts`. Convert from `auth.controller.ts` (lines 1-73).

```typescript
import type { FastifyInstance, FastifyRequest } from "fastify";

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.get("/api/auth/providers", async () => {
    return fastify.authService.listProviders();
  });

  fastify.post(
    "/api/auth/login",
    async (
      request: FastifyRequest<{
        Body: { email: string; password: string; totpCode?: string; clientId?: string };
      }>,
    ) => {
      const { email, password, totpCode, clientId } = request.body;
      return fastify.authService.loginWithPassword({
        email,
        password,
        totpCode,
        clientId: clientId ?? "desktop",
      });
    },
  );

  fastify.post(
    "/api/auth/refresh",
    async (
      request: FastifyRequest<{
        Body: { refreshToken: string };
      }>,
    ) => {
      return fastify.authService.refreshTokens(request.body.refreshToken);
    },
  );

  fastify.post(
    "/api/auth/oidc/start",
    async (
      request: FastifyRequest<{
        Body: { providerId: string; redirectUri: string; clientId?: string };
      }>,
    ) => {
      const { providerId, redirectUri, clientId } = request.body;
      return fastify.authOidcService.startOidc(
        providerId,
        redirectUri,
        clientId ?? "desktop",
        false,
      );
    },
  );

  fastify.post(
    "/api/auth/oidc/complete",
    async (
      request: FastifyRequest<{
        Body: {
          providerId?: string;
          redirectUri: string;
          state: string;
          code: string;
          clientId?: string;
        };
      }>,
    ) => {
      const { providerId, redirectUri, state, code, clientId } = request.body;
      return fastify.authOidcService.completeOidc({
        providerId,
        redirectUri,
        state,
        code,
        clientId: clientId ?? "desktop",
      });
    },
  );
}
```

- [ ] **Step 3: Create notes routes**

Create `src/routes/notes.ts`. Convert from `notes.controller.ts` (lines 1-169). Reference the original file directly — every route maps 1:1. Use `{ preHandler: [fastify.authenticate] }` for all routes. Access `request.user!.userId` instead of the `@CurrentUser()` decorator.

- [ ] **Step 4: Create attachments routes**

Create `src/routes/attachments.ts`. Convert from `attachments.controller.ts` (lines 1-59). Use `{ preHandler: [fastify.authenticateAttachment] }`. For the upload endpoint, use `@fastify/multipart` to handle file uploads. For the download endpoint, return a stream with appropriate headers.

- [ ] **Step 5: Create calendar routes**

Create `src/routes/calendar.ts`. Convert from `calendar.controller.ts` (lines 1-297). All routes use `{ preHandler: [fastify.authenticate] }` except the OAuth callback (`GET /api/calendar/oauth/callback`) which is public. Reference the original controller — every route maps 1:1.

- [ ] **Step 6: Create AI routes**

Create `src/routes/ai.ts`. Convert from `ai.controller.ts` (lines 1-223). The SSE streaming endpoint (`POST /api/ai/conversations/:conversationId/messages`) needs special handling:

```typescript
// SSE streaming pattern in Fastify:
fastify.post(
  "/api/ai/conversations/:conversationId/messages",
  {
    preHandler: [fastify.authenticate],
  },
  async (request, reply) => {
    // Set SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const stream = fastify.agentService.streamResponse(/* ... */);
    for await (const event of stream) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    reply.raw.end();

    // Don't return — we already wrote the response via raw
    return reply;
  },
);
```

Handle request abort via `request.raw.on("close", () => { ... })`.

- [ ] **Step 7: Create admin routes**

Create `src/routes/admin.ts`. Convert from `internal-admin.controller.ts` (lines 1-327). Public routes (bootstrap-status, login, setup-initial, OIDC) have no preHandler. Protected routes use `{ preHandler: [fastify.authenticateAdmin] }`.

- [ ] **Step 8: Verify all route files are under 500 lines**

Run: `wc -l apps/core-backend/src/routes/*.ts`
Expected: All files under 500 lines. `calendar.ts` and `admin.ts` are the most likely to be close — if either exceeds 500, split into sub-files (e.g., `calendar-events.ts` + `calendar-connections.ts`).

---

## Task 11: Create Server Entry Point

**Files:**

- Create: `apps/core-backend/src/server.ts`

- [ ] **Step 1: Create the Fastify server builder**

Create `src/server.ts`. This replaces `main.ts` + `app.module.ts`. It builds the Fastify instance, registers all plugins in dependency order, registers all routes, and starts the server.

```typescript
import "./config/env";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { createConfig } from "./lib/config";

// Plugins
import prismaPlugin from "./plugins/prisma";
import authPlugin from "./plugins/auth";
import servicesPlugin from "./plugins/services";
import jobsPlugin from "./plugins/jobs";
import collaborationPlugin from "./plugins/collaboration";

// Routes
import healthRoutes from "./routes/health";
import authRoutes from "./routes/auth";
import notesRoutes from "./routes/notes";
import attachmentsRoutes from "./routes/attachments";
import calendarRoutes from "./routes/calendar";
import aiRoutes from "./routes/ai";
import adminRoutes from "./routes/admin";

export async function buildApp(options: { logger?: boolean | object } = {}) {
  const fastify = Fastify({
    logger: options.logger ?? {
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  // Config helper (replaces @fastify/config)
  const config = createConfig();
  fastify.decorate("config", config);

  // Core plugins (order matters — each can depend on previously registered ones)
  await fastify.register(cors);
  await fastify.register(multipart);
  await fastify.register(prismaPlugin);
  await fastify.register(authPlugin);
  await fastify.register(servicesPlugin);
  await fastify.register(jobsPlugin);
  await fastify.register(collaborationPlugin);

  // Routes
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(notesRoutes);
  await fastify.register(attachmentsRoutes);
  await fastify.register(calendarRoutes);
  await fastify.register(aiRoutes);
  await fastify.register(adminRoutes);

  return fastify;
}

// Start server when run directly
async function start() {
  const app = await buildApp();
  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen({ port, host: "0.0.0.0" });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Update package.json scripts**

Update `apps/core-backend/package.json`:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/src/server.js",
    "start:dev": "tsx watch src/server.ts",
    "test": "jest --runInBand",
    "lint": "tsc --noEmit -p tsconfig.json"
  }
}
```

Remove the `prebuild` script that called `nest build`. The build is now just `tsc`. Add `tsx` as a dev dependency for watch mode: `npm install --workspace @slate/core-backend --save-dev tsx`.

- [ ] **Step 3: Verify server starts**

Run: `cd apps/core-backend && npx tsx src/server.ts &`
Wait 3 seconds, then: `curl http://localhost:4000/api/health`
Expected: `{"ok":true}`
Kill the server.

---

## Task 12: Migrate Test Infrastructure

**Files:**

- Modify: `apps/core-backend/test/helpers/test-app.ts`

- [ ] **Step 1: Rewrite test-app.ts**

Replace the Fastify test helper with one that builds a Fastify app:

```typescript
import type { FastifyInstance } from "fastify";
import { PrismaClient, AppConfigName } from "@slate/server-db";
import { buildApp } from "../../src/server";

function ensureSafeTestDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for tests and must point to a dedicated test database",
    );
  }
  let dbName = "";
  try {
    dbName =
      new URL(databaseUrl).pathname.replace(/^\//, "").split("/").filter(Boolean).pop() ?? "";
  } catch {
    throw new Error("DATABASE_URL is invalid");
  }
  if (!dbName.toLowerCase().includes("test")) {
    throw new Error(`Refusing to run tests against non-test database '${dbName}'`);
  }
}

export async function createTestApp(): Promise<{ app: FastifyInstance; prisma: PrismaClient }> {
  ensureSafeTestDatabaseUrl();

  const app = await buildApp({ logger: false });
  await app.ready();

  return { app, prisma: app.prisma as unknown as PrismaClient };
}

export async function resetDatabase(app: FastifyInstance) {
  const prisma = app.prisma;
  await prisma.appConfig.deleteMany();
  await prisma.oidcAuthRequest.deleteMany();
  await prisma.oidcProviderConfig.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.document.deleteMany();
  await prisma.deviceCursor.deleteMany();
  await prisma.totpEnrollment.deleteMany();
  await prisma.authIdentity.deleteMany();
  await prisma.user.deleteMany();
  await prisma.appConfig.create({
    data: { name: AppConfigName.ACCOUNT_CREATION_ENABLED, value: "true" },
  });
  await prisma.appConfig.create({
    data: { name: AppConfigName.PASSWORD_AUTH_ENABLED, value: "true" },
  });
}
```

- [ ] **Step 2: Update integration tests**

Update all 5 integration test files in `test/` to use the new helper. The main changes:

- `app.close()` → `app.close()` (same API in Fastify)
- `app.get(SomeService)` → `app.someService` (access via Fastify decoration)
- `app.get(PrismaService)` → `app.prisma`
- `request(app.getHttpServer())` → `request(app.server)` (Fastify's raw HTTP server)

Example change pattern:

```typescript
// Before
const { app, prisma } = await createTestApp();
const service = app.get(SomeService);

// After
const { app, prisma } = await createTestApp();
const service = app.someService;
```

- [ ] **Step 3: Update unit tests that use Fastify TestingModule**

Search all `.spec.ts` files for `@fastify/testing`. For each:

```typescript
// Before (Fastify pattern)
import { Test } from "@fastify/testing";
const module = await Test.createTestingModule({
  providers: [Service, { provide: Dep, useValue: mock }],
}).compile();
service = module.get(Service);

// After (direct instantiation)
service = new Service(mockDep);
```

Most unit tests already use direct instantiation or mock patterns that don't depend on Fastify DI. The ones that do use `Test.createTestingModule` need to switch to `new Service(mocks)`.

For tests that override guards:

```typescript
// Before
.overrideGuard(HttpAuthGuard).useValue({ canActivate: () => true })

// After — guards are now preHandlers, so mock the authenticate function
// OR test routes via the full app with a real/mocked JWT
```

Controller HTTP tests (e.g., `auth.controller.http.spec.ts`) either:

1. Convert to route-level tests using the Fastify test app, OR
2. Test services directly (since routes are thin wrappers)

- [ ] **Step 4: Run tests to check progress**

Run: `cd apps/core-backend && npm test 2>&1 | tail -20`
Expected: Some tests may still fail if they import deleted Fastify files. Track failures.

---

## Task 13: Delete Fastify Files

**Files:** All files listed in "Files to DELETE" section above (25 files).

- [ ] **Step 1: Delete all Fastify-specific files**

Delete every file listed in the "Files to DELETE" section:

```
src/main.ts
src/app.module.ts
src/prisma/prisma.module.ts
src/prisma/prisma.service.ts
src/settings/settings.module.ts
src/auth/auth.module.ts
src/auth/auth.controller.ts
src/auth/http-auth.guard.ts
src/auth/current-user.decorator.ts
src/notes/notes.module.ts
src/notes/notes.controller.ts
src/attachments/attachments.module.ts
src/attachments/attachments.controller.ts
src/attachments/attachments.guard.ts
src/calendar/calendar.module.ts
src/calendar/calendar.controller.ts
src/search/search.module.ts
src/ai/ai.module.ts
src/ai/ai.controller.ts
src/documents/documents.module.ts
src/internal-admin/internal-admin.module.ts
src/internal-admin/internal-admin.controller.ts
src/internal-admin/internal-admin.guard.ts
src/collaboration/collaboration.module.ts
src/collaboration/collaboration.gateway.ts
src/jobs/jobs.module.ts
```

- [ ] **Step 2: Remove Fastify dependencies from package.json**

Remove these packages from `apps/core-backend/package.json`:

**dependencies to remove:**

- `@fastify/common`
- `@fastify/config`
- `@fastify/core`
- `@fastify/jwt`
- `@fastify/passport`
- `@fastify/platform-express`
- `@fastify/platform-ws`
- `@fastify/websockets`
- `fastify-pino`
- `pino-http`
- `passport`
- `passport-google-oauth20`
- `class-validator`
- `class-transformer`
- `reflect-metadata`

**devDependencies to remove:**

- `@fastify/cli`
- `@fastify/schematics`
- `@fastify/testing`
- `@types/express` (Fastify has its own types)

**Keep:** `pino`, `pino-pretty`, `rxjs` (if used by LangChain), `ws`, all AI/calendar/storage/auth deps.

Run: `cd /Users/jason/Desktop/git/slate && npm install` to clean up lockfile.

- [ ] **Step 3: Delete nest-cli.json if it exists**

Run: `rm -f apps/core-backend/nest-cli.json`

- [ ] **Step 4: Verify no imports reference deleted files**

Run: `grep -r "@fastify" apps/core-backend/src/ --include="*.ts" | grep -v node_modules | grep -v ".spec.ts"`
Expected: Zero results.

Run: `grep -r "from.*prisma.service" apps/core-backend/src/ --include="*.ts" | grep -v node_modules | grep -v ".spec.ts"`
Expected: Zero results (services now import PrismaClient directly from @slate/server-db).

---

## Task 14: Update Build + Docker Configuration

**Files:**

- Modify: `apps/core-backend/tsconfig.build.json`
- Modify: `apps/core-backend/Dockerfile`
- Modify: `apps/core-backend/Dockerfile.dev`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Update tsconfig.build.json**

Ensure it excludes tests and includes the new file structure. The entry point is now `src/server.ts`.

- [ ] **Step 2: Update Dockerfile**

Change the start command from `npm run start` (which ran `node dist/src/main.js`) to point to the new entry:

```dockerfile
CMD ["node", "dist/src/server.js"]
```

Remove the `nest build` command and replace with `tsc`:

```dockerfile
RUN npm run build --workspace @slate/core-backend
```

Remove the 8GB heap allocation (`NODE_OPTIONS='--max-old-space-size=8192'`) since tsc doesn't need it (nest build was the culprit).

- [ ] **Step 3: Update Dockerfile.dev**

Change dev command to use tsx watch:

```dockerfile
CMD ["npx", "tsx", "watch", "src/server.ts"]
```

---

## Task 15: Final Verification

- [ ] **Step 1: Verify build**

Run: `cd apps/core-backend && npm run build`
Expected: Successful TypeScript compilation with zero errors.

- [ ] **Step 2: Verify no Fastify remnants**

Run: `grep -r "@fastify\|@Module\|@Controller\|@Injectable\|@UseGuards\|@Get(\|@Post(\|@Patch(\|@Delete(\|@Body()\|@Param(\|@Query(" apps/core-backend/src/ --include="*.ts" | grep -v node_modules | grep -v ".spec.ts"`
Expected: Zero results.

- [ ] **Step 3: Verify no files >500 lines**

Run: `find apps/core-backend/src -name "*.ts" ! -name "*.spec.ts" | xargs wc -l | sort -rn | head -10`
Expected: All files under 500 lines.

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/jason/Desktop/git/slate && make core-test`
Expected: All 37 tests pass. If any fail, diagnose and fix. Common issues:

- Import paths changed (update imports)
- Service constructor signatures changed (update mock setups)
- `app.get(Service)` calls in integration tests (change to `app.serviceName`)
- Guard mocking patterns need updating

- [ ] **Step 5: Verify server starts with all features**

Start the database: `make db-up`
Start the server: `cd apps/core-backend && npx tsx src/server.ts`
Test endpoints:

```bash
curl http://localhost:4000/api/health                    # Should return {"ok":true}
curl http://localhost:4000/api/auth/providers             # Should return provider list
curl http://localhost:4000/internal/admin/bootstrap-status # Should return user count
```

- [ ] **Step 6: Verify package.json has no Fastify deps**

Run: `cat apps/core-backend/package.json | grep -i nest`
Expected: Zero results.
