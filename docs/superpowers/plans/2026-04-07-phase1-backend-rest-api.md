# Phase 1: Backend REST API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add REST + SSE HTTP endpoints to the Fastify backend alongside existing gRPC, so that gRPC continues to work and the new REST API is also available.

**Architecture:** Add `@Get/@Post/@Patch/@Delete` HTTP handler methods to existing gRPC controllers. Auth uses a new `HttpAuthGuard` that validates `Authorization: Bearer <token>` headers via the existing `AuthSessionService.validateAccessToken`. New `NotesModule` handles note metadata CRUD against the existing `Document` Prisma model.

**Tech Stack:** Fastify 11, Prisma, Express (underlying HTTP), Jest for tests.

---

## File Map

- Create: `apps/core-backend/src/auth/http-auth.guard.ts`
- Create: `apps/core-backend/src/auth/http-auth.guard.spec.ts`
- Create: `apps/core-backend/src/auth/current-user.decorator.ts`
- Create: `apps/core-backend/src/notes/notes.controller.ts`
- Create: `apps/core-backend/src/notes/notes.controller.spec.ts`
- Create: `apps/core-backend/src/notes/notes.module.ts`
- Modify: `apps/core-backend/src/auth/auth.controller.ts`
- Modify: `apps/core-backend/src/auth/auth.module.ts`
- Modify: `apps/core-backend/src/ai/ai.controller.ts`
- Modify: `apps/core-backend/src/calendar/calendar.controller.ts`
- Modify: `apps/core-backend/src/app.module.ts`

---

### Task 1: HttpAuthGuard + CurrentUser decorator

**Files:**
- Create: `apps/core-backend/src/auth/http-auth.guard.ts`
- Create: `apps/core-backend/src/auth/http-auth.guard.spec.ts`
- Create: `apps/core-backend/src/auth/current-user.decorator.ts`
- Modify: `apps/core-backend/src/auth/auth.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/core-backend/src/auth/http-auth.guard.spec.ts`:

```typescript
import { ExecutionContext, UnauthorizedException } from "@fastify/common";
import { HttpAuthGuard } from "./http-auth.guard";
import { AuthSessionService } from "./auth-session.service";

describe("HttpAuthGuard", () => {
  let guard: HttpAuthGuard;
  let authSession: jest.Mocked<Pick<AuthSessionService, "validateAccessToken">>;

  beforeEach(() => {
    authSession = { validateAccessToken: jest.fn() };
    guard = new HttpAuthGuard(authSession as any);
  });

  function makeContext(authHeader?: string): ExecutionContext {
    const request: any = {
      headers: authHeader ? { authorization: authHeader } : {},
      user: undefined,
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
  }

  it("sets request.user and returns true for a valid Bearer token", async () => {
    const user = { userId: "u1", email: "a@b.com", displayName: "A", isAdmin: false };
    authSession.validateAccessToken.mockResolvedValue(user as any);
    const ctx = makeContext("Bearer valid-jwt");
    expect(await guard.canActivate(ctx)).toBe(true);
    expect((ctx.switchToHttp().getRequest() as any).user).toEqual(user);
  });

  it("throws UnauthorizedException when Authorization header is absent", async () => {
    await expect(guard.canActivate(makeContext())).rejects.toThrow(UnauthorizedException);
  });

  it("throws UnauthorizedException when header has no Bearer prefix", async () => {
    await expect(guard.canActivate(makeContext("basic abc"))).rejects.toThrow(UnauthorizedException);
  });

  it("throws UnauthorizedException when validateAccessToken rejects", async () => {
    authSession.validateAccessToken.mockRejectedValue(new Error("expired"));
    await expect(guard.canActivate(makeContext("Bearer bad"))).rejects.toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/core-backend && npm test -- --testPathPattern=http-auth.guard
```

Expected: FAIL with "Cannot find module './http-auth.guard'"

- [ ] **Step 3: Create HttpAuthGuard**

Create `apps/core-backend/src/auth/http-auth.guard.ts`:

```typescript
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from "@fastify/common";
import { AuthSessionService } from "./auth-session.service";

@Injectable()
export class HttpAuthGuard implements CanActivate {
  constructor(private readonly authSession: AuthSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Record<string, any>>();
    const header = request.headers["authorization"] as string | undefined;
    if (typeof header !== "string") {
      throw new UnauthorizedException("Missing authorization token");
    }
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw new UnauthorizedException("Missing authorization token");
    }
    try {
      request["user"] = await this.authSession.validateAccessToken(match[1]);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
    return true;
  }
}
```

Create `apps/core-backend/src/auth/current-user.decorator.ts`:

```typescript
import { createParamDecorator, ExecutionContext } from "@fastify/common";

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<any>()["user"],
);
```

- [ ] **Step 4: Export HttpAuthGuard from AuthModule**

In `apps/core-backend/src/auth/auth.module.ts`, add `HttpAuthGuard` to providers and exports:

```typescript
import { Module } from "@fastify/common";
import { JwtModule } from "@fastify/jwt";
import { ConfigService } from "@fastify/config";
import { SettingsModule } from "../settings/settings.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthSessionService } from "./auth-session.service";
import { HttpAuthGuard } from "./http-auth.guard";

@Module({
  imports: [
    SettingsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("JWT_SECRET", "local-dev-secret"),
        signOptions: { expiresIn: "1h" },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthSessionService, HttpAuthGuard],
  exports: [AuthService, AuthSessionService, JwtModule, HttpAuthGuard],
})
export class AuthModule {}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/core-backend && npm test -- --testPathPattern=http-auth.guard
```

Expected: PASS (4 tests pass)

- [ ] **Step 6: Commit**

```bash
cd apps/core-backend && git add src/auth/http-auth.guard.ts src/auth/http-auth.guard.spec.ts src/auth/current-user.decorator.ts src/auth/auth.module.ts
git commit -m "feat(backend): add HttpAuthGuard and CurrentUser decorator for REST auth"
```

---

### Task 2: Notes Metadata REST Controller

**Files:**
- Create: `apps/core-backend/src/notes/notes.controller.ts`
- Create: `apps/core-backend/src/notes/notes.controller.spec.ts`
- Create: `apps/core-backend/src/notes/notes.module.ts`
- Modify: `apps/core-backend/src/app.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/core-backend/src/notes/notes.controller.spec.ts`:

```typescript
import { Test, TestingModule } from "@fastify/testing";
import { NotesController } from "./notes.controller";
import { PrismaService } from "../prisma/prisma.service";
import { HttpAuthGuard } from "../auth/http-auth.guard";

describe("NotesController", () => {
  let controller: NotesController;
  let prisma: { document: jest.Mocked<any> };

  beforeEach(async () => {
    prisma = {
      document: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        $transaction: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotesController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    })
      .overrideGuard(HttpAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<NotesController>(NotesController);
  });

  const user = { userId: "user-1" };

  it("listNotes: returns documents for the current user", async () => {
    const docs = [{ id: "n1", title: "Test", path: "test", pinned: false, createdAt: new Date(), updatedAt: new Date() }];
    prisma.document.findMany.mockResolvedValue(docs);
    const result = await controller.listNotes(user as any);
    expect(result).toEqual(docs);
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", deleted: false } }),
    );
  });

  it("createNote: creates and returns a document", async () => {
    const doc = { id: "n2", title: "New", path: "new", pinned: false, createdAt: new Date(), updatedAt: new Date() };
    prisma.document.create.mockResolvedValue(doc);
    const result = await controller.createNote({ path: "new", title: "New" }, user as any);
    expect(result).toEqual(doc);
    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "user-1", path: "new", title: "New" }) }),
    );
  });

  it("updateNote: patches a document", async () => {
    const doc = { id: "n1", title: "Updated", path: "test", pinned: true, createdAt: new Date(), updatedAt: new Date() };
    prisma.document.update.mockResolvedValue(doc);
    const result = await controller.updateNote("n1", { title: "Updated", pinned: true }, user as any);
    expect(result).toEqual(doc);
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "n1", userId: "user-1" } }),
    );
  });

  it("deleteNote: hard deletes the document", async () => {
    prisma.document.delete.mockResolvedValue({});
    const result = await controller.deleteNote("n1", user as any);
    expect(result).toEqual({});
    expect(prisma.document.delete).toHaveBeenCalledWith({ where: { id: "n1", userId: "user-1" } });
  });

  it("syncNotes: returns notes updated since the given timestamp", async () => {
    const docs = [{ id: "n1", title: "T", path: "p", pinned: false, deleted: false, createdAt: new Date(), updatedAt: new Date() }];
    prisma.document.findMany.mockResolvedValue(docs);
    const result = await controller.syncNotes("2024-01-01T00:00:00Z", user as any);
    expect(result).toEqual(docs);
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user-1" }) }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/core-backend && npm test -- --testPathPattern=notes.controller
```

Expected: FAIL with "Cannot find module './notes.controller'"

- [ ] **Step 3: Create NotesController**

Create `apps/core-backend/src/notes/notes.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from "@fastify/common";
import { PrismaService } from "../prisma/prisma.service";
import { HttpAuthGuard } from "../auth/http-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";

interface Session {
  userId: string;
}

const NOTE_SELECT = {
  id: true,
  title: true,
  path: true,
  pinned: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Controller()
export class NotesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("api/notes/sync")
  @UseGuards(HttpAuthGuard)
  async syncNotes(@Query("since") since: string, @CurrentUser() user: Session) {
    const sinceDate = since ? new Date(since) : new Date(0);
    return this.prisma.document.findMany({
      where: { userId: user.userId, updatedAt: { gt: sinceDate } },
      select: { ...NOTE_SELECT, deleted: true },
      orderBy: { updatedAt: "asc" },
    });
  }

  @Get("api/notes")
  @UseGuards(HttpAuthGuard)
  async listNotes(@CurrentUser() user: Session) {
    return this.prisma.document.findMany({
      where: { userId: user.userId, deleted: false },
      select: NOTE_SELECT,
      orderBy: { updatedAt: "desc" },
    });
  }

  @Post("api/notes")
  @UseGuards(HttpAuthGuard)
  async createNote(
    @Body() body: { id?: string; path: string; title: string },
    @CurrentUser() user: Session,
  ) {
    return this.prisma.document.create({
      data: {
        ...(body.id ? { id: body.id } : {}),
        userId: user.userId,
        path: body.path,
        title: body.title,
        markdown: "",
        plainText: "",
      },
      select: NOTE_SELECT,
    });
  }

  @Patch("api/notes/:id")
  @UseGuards(HttpAuthGuard)
  async updateNote(
    @Param("id") id: string,
    @Body() body: { path?: string; title?: string; pinned?: boolean; plainText?: string; deleted?: boolean },
    @CurrentUser() user: Session,
  ) {
    return this.prisma.document.update({
      where: { id, userId: user.userId },
      data: {
        ...(body.path !== undefined ? { path: body.path } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
        ...(body.plainText !== undefined ? { plainText: body.plainText, markdown: body.plainText } : {}),
        ...(body.deleted !== undefined ? { deleted: body.deleted } : {}),
      },
      select: NOTE_SELECT,
    });
  }

  @Delete("api/notes/:id")
  @UseGuards(HttpAuthGuard)
  async deleteNote(@Param("id") id: string, @CurrentUser() user: Session) {
    await this.prisma.document.delete({ where: { id, userId: user.userId } });
    return {};
  }

  @Post("api/notes/import")
  @UseGuards(HttpAuthGuard)
  async importNotes(
    @Body()
    body: {
      notes: Array<{
        id?: string;
        path: string;
        title: string;
        markdown?: string;
        plainText?: string;
      }>;
    },
    @CurrentUser() user: Session,
  ) {
    const created = await this.prisma.$transaction(
      body.notes.map((note) =>
        this.prisma.document.create({
          data: {
            ...(note.id ? { id: note.id } : {}),
            userId: user.userId,
            path: note.path,
            title: note.title,
            markdown: note.markdown ?? "",
            plainText: note.plainText ?? "",
          },
          select: NOTE_SELECT,
        }),
      ),
    );
    return { created };
  }
}
```

- [ ] **Step 4: Create NotesModule**

Create `apps/core-backend/src/notes/notes.module.ts`:

```typescript
import { Module } from "@fastify/common";
import { AuthModule } from "../auth/auth.module";
import { NotesController } from "./notes.controller";

@Module({
  imports: [AuthModule],
  controllers: [NotesController],
})
export class NotesModule {}
```

- [ ] **Step 5: Add NotesModule to AppModule**

In `apps/core-backend/src/app.module.ts`, add the import:

```typescript
import { NotesModule } from "./notes/notes.module";

// In the @Module imports array, add:
NotesModule,
```

Full updated imports array in AppModule:

```typescript
imports: [
  ConfigModule.forRoot({ ... }),
  LoggerModule.forRoot({ ... }),
  PrismaModule,
  SettingsModule,
  JobsModule,
  AuthModule,
  InternalAdminModule,
  DocumentsModule,
  StorageModule,
  AttachmentsModule,
  SearchModule,
  AiModule,
  CalendarModule,
  CollaborationModule,
  NotesModule,
],
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/core-backend && npm test -- --testPathPattern=notes.controller
```

Expected: PASS (5 tests pass)

- [ ] **Step 7: Commit**

```bash
cd apps/core-backend && git add src/notes/ src/app.module.ts
git commit -m "feat(backend): add notes metadata REST controller (GET/POST/PATCH/DELETE /api/notes)"
```

---

### Task 3: REST Auth Endpoints

**Files:**
- Modify: `apps/core-backend/src/auth/auth.controller.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/core-backend/src/auth/auth.controller.http.spec.ts`:

```typescript
import { Test, TestingModule } from "@fastify/testing";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthSessionService } from "./auth-session.service";
import { HttpAuthGuard } from "./http-auth.guard";

describe("AuthController HTTP endpoints", () => {
  let controller: AuthController;
  let authService: jest.Mocked<Partial<AuthService>>;
  let authSession: jest.Mocked<Partial<AuthSessionService>>;

  const fakeTokens = { accessToken: "at", refreshToken: "rt", expiresAtUnix: 9999 };

  beforeEach(async () => {
    authService = {
      listProviders: jest.fn().mockResolvedValue({ providers: [] }),
      loginWithPassword: jest.fn().mockResolvedValue({
        userId: "u1", tokens: fakeTokens, email: "a@b.com", displayName: "A", isAdmin: false,
      }),
      refreshTokens: jest.fn().mockResolvedValue(fakeTokens),
      getCurrentSession: jest.fn().mockResolvedValue({ userId: "u1", email: "a@b.com" }),
    };
    authSession = { validateAccessToken: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: AuthSessionService, useValue: authSession },
        { provide: HttpAuthGuard, useValue: { canActivate: () => true } },
      ],
    })
      .overrideGuard(HttpAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it("listProvidersHttp returns auth providers", async () => {
    const result = await controller.listProvidersHttp();
    expect(authService.listProviders).toHaveBeenCalled();
    expect(result).toEqual({ providers: [] });
  });

  it("loginWithPasswordHttp returns tokens", async () => {
    const result = await controller.loginWithPasswordHttp({
      email: "a@b.com", password: "pw", clientId: "c1",
    });
    expect(result).toMatchObject({ userId: "u1", tokens: fakeTokens });
  });

  it("refreshTokensHttp returns new tokens", async () => {
    const result = await controller.refreshTokensHttp({ refreshToken: "old-rt" });
    expect(result).toEqual(fakeTokens);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/core-backend && npm test -- --testPathPattern=auth.controller.http
```

Expected: FAIL with "controller.listProvidersHttp is not a function"

- [ ] **Step 3: Add REST methods to AuthController**

In `apps/core-backend/src/auth/auth.controller.ts`, add the following imports at the top (alongside existing ones):

```typescript
import { Controller, Get, Post, Body, HttpCode, HttpStatus, Logger } from "@fastify/common";
import { GrpcMethod, RpcException } from "@fastify/microservices";
import { Metadata, status } from "@grpc/grpc-js";
import { AuthService } from "./auth.service";
import { AuthSessionService } from "./auth-session.service";
```

Then add these HTTP methods at the end of the `AuthController` class (before the closing `}`):

```typescript
  // ── REST: Auth ──

  @Get("api/auth/providers")
  async listProvidersHttp() {
    return this.authService.listProviders();
  }

  @Post("api/auth/login")
  @HttpCode(HttpStatus.OK)
  async loginWithPasswordHttp(
    @Body() body: { email: string; password: string; totpCode?: string; clientId?: string },
  ) {
    return this.authService.loginWithPassword({
      email: body.email,
      password: body.password,
      totpCode: body.totpCode,
      clientId: body.clientId ?? "desktop",
    });
  }

  @Post("api/auth/refresh")
  @HttpCode(HttpStatus.OK)
  async refreshTokensHttp(@Body() body: { refreshToken: string }) {
    return this.authService.refreshTokens(body.refreshToken);
  }

  @Post("api/auth/oidc/start")
  @HttpCode(HttpStatus.OK)
  async startOidcHttp(
    @Body() body: { providerId: string; redirectUri: string; clientId?: string },
  ) {
    return this.authService.startOidc(
      body.providerId,
      body.redirectUri,
      body.clientId ?? "desktop",
      false,
    );
  }

  @Post("api/auth/oidc/complete")
  @HttpCode(HttpStatus.OK)
  async completeOidcHttp(
    @Body() body: { providerId?: string; redirectUri: string; state: string; code: string; clientId?: string },
  ) {
    return this.authService.completeOidc({
      providerId: body.providerId,
      redirectUri: body.redirectUri,
      state: body.state,
      code: body.code,
      clientId: body.clientId ?? "desktop",
    });
  }

  @Get("api/health")
  health() {
    return { ok: true };
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/core-backend && npm test -- --testPathPattern=auth.controller.http
```

Expected: PASS (3 tests pass)

- [ ] **Step 5: Commit**

```bash
cd apps/core-backend && git add src/auth/auth.controller.ts src/auth/auth.controller.http.spec.ts
git commit -m "feat(backend): add REST auth endpoints (login, refresh, OIDC, providers, health)"
```

---

### Task 4: REST AI Endpoints (Non-Streaming)

**Files:**
- Modify: `apps/core-backend/src/ai/ai.controller.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/core-backend/src/ai/ai.controller.http.spec.ts`:

```typescript
import { Test, TestingModule } from "@fastify/testing";
import { AiController } from "./ai.controller";
import { AiConfigService } from "./ai-config.service";
import { ConversationService } from "./conversation.service";
import { AgentService } from "./agent.service";
import { EmbeddingService } from "./embedding.service";
import { ModelProviderService } from "./model-provider.service";
import { PrismaService } from "../prisma/prisma.service";
import { JobsService } from "../jobs/jobs.service";
import { AuthSessionService } from "../auth/auth-session.service";
import { HttpAuthGuard } from "../auth/http-auth.guard";

describe("AiController HTTP endpoints", () => {
  let controller: AiController;
  let aiConfigService: jest.Mocked<Partial<AiConfigService>>;
  let conversationService: jest.Mocked<Partial<ConversationService>>;
  let agentService: jest.Mocked<Partial<AgentService>>;
  let modelProvider: jest.Mocked<Partial<ModelProviderService>>;
  let prisma: jest.Mocked<any>;
  let jobsService: jest.Mocked<Partial<JobsService>>;

  const user = { userId: "u1" };

  beforeEach(async () => {
    const cfg = { chatProvider: "openai", chatModel: "gpt-4" };
    aiConfigService = {
      getConfig: jest.fn().mockResolvedValue(cfg),
      upsertConfig: jest.fn().mockResolvedValue({ config: cfg, embeddingModelOrProviderChanged: false, chatStreamingConfigChanged: false }),
    };
    conversationService = {
      createConversation: jest.fn().mockResolvedValue({ id: "c1", title: null, createdAt: new Date(), updatedAt: new Date() }),
      listConversations: jest.fn().mockResolvedValue([]),
      deleteConversation: jest.fn().mockResolvedValue(undefined),
      getMessages: jest.fn().mockResolvedValue([]),
    };
    agentService = { abortActiveChatStream: jest.fn() };
    modelProvider = { invalidateCache: jest.fn() };
    prisma = { document: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    jobsService = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        { provide: AiConfigService, useValue: aiConfigService },
        { provide: ConversationService, useValue: conversationService },
        { provide: AgentService, useValue: agentService },
        { provide: EmbeddingService, useValue: {} },
        { provide: ModelProviderService, useValue: modelProvider },
        { provide: PrismaService, useValue: prisma },
        { provide: JobsService, useValue: jobsService },
        { provide: AuthSessionService, useValue: {} },
        { provide: HttpAuthGuard, useValue: { canActivate: () => true } },
      ],
    })
      .overrideGuard(HttpAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AiController>(AiController);
  });

  it("getAiConfigHttp returns masked config", async () => {
    const result = await controller.getAiConfigHttp(user as any);
    expect(result).toMatchObject({ chatProvider: "openai", chatModel: "gpt-4" });
  });

  it("createConversationHttp returns new conversation", async () => {
    const result = await controller.createConversationHttp(user as any);
    expect(result).toMatchObject({ id: "c1", messageCount: 0 });
  });

  it("listConversationsHttp returns array", async () => {
    const result = await controller.listConversationsHttp(user as any);
    expect(result).toEqual({ conversations: [] });
  });

  it("deleteConversationHttp delegates to service", async () => {
    await controller.deleteConversationHttp("c1", user as any);
    expect(conversationService.deleteConversation).toHaveBeenCalledWith("c1", "u1");
  });

  it("getConversationMessagesHttp returns messages", async () => {
    const result = await controller.getConversationMessagesHttp("c1", user as any);
    expect(result).toEqual({ messages: [] });
  });

  it("triggerEmbeddingHttp enqueues embedding job", async () => {
    const result = await controller.triggerEmbeddingHttp(user as any);
    expect(result).toMatchObject({ documentsQueued: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/core-backend && npm test -- --testPathPattern=ai.controller.http
```

Expected: FAIL with "controller.getAiConfigHttp is not a function"

- [ ] **Step 3: Add HTTP imports and REST methods to AiController**

In `apps/core-backend/src/ai/ai.controller.ts`, update imports to add:

```typescript
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
} from "@fastify/common";
import { GrpcMethod, RpcException } from "@fastify/microservices";
import { Metadata, status } from "@grpc/grpc-js";
import { Observable, Subject } from "rxjs";
import { AuthSessionService } from "../auth/auth-session.service";
import { AiConfigService } from "./ai-config.service";
import { ConversationService } from "./conversation.service";
import { AgentService } from "./agent.service";
import { EmbeddingService } from "./embedding.service";
import { ModelProviderService } from "./model-provider.service";
import { PrismaService } from "../prisma/prisma.service";
import { JobsService } from "../jobs/jobs.service";
import { HttpAuthGuard } from "../auth/http-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
```

Then add these methods at the end of the `AiController` class (before closing `}`):

```typescript
  // ── REST: AI ──

  @Get("api/ai/config")
  @UseGuards(HttpAuthGuard)
  async getAiConfigHttp(@CurrentUser() user: { userId: string }) {
    const config = await this.aiConfigService.getConfig(user.userId);
    return maskConfig(config);
  }

  @Put("api/ai/config")
  @UseGuards(HttpAuthGuard)
  async updateAiConfigHttp(
    @Body()
    body: {
      embeddingProvider?: string;
      embeddingModel?: string;
      embeddingEndpoint?: string;
      embeddingApiKey?: string;
      chatProvider?: string;
      chatModel?: string;
      chatEndpoint?: string;
      chatApiKey?: string;
    },
    @CurrentUser() user: { userId: string },
  ) {
    const { config, embeddingModelOrProviderChanged, chatStreamingConfigChanged } =
      await this.aiConfigService.upsertConfig(user.userId, body);
    if (embeddingModelOrProviderChanged || chatStreamingConfigChanged) {
      this.modelProvider.invalidateCache(user.userId);
    }
    if (chatStreamingConfigChanged) {
      this.agentService.abortActiveChatStream(user.userId);
    }
    return maskConfig(config, { chatStreamingConfigChanged });
  }

  @Post("api/ai/conversations")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async createConversationHttp(@CurrentUser() user: { userId: string }) {
    const conversation = await this.conversationService.createConversation(user.userId);
    return {
      id: conversation.id,
      title: (conversation as any).title ?? undefined,
      messageCount: 0,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  @Get("api/ai/conversations")
  @UseGuards(HttpAuthGuard)
  async listConversationsHttp(@CurrentUser() user: { userId: string }) {
    const conversations = await this.conversationService.listConversations(user.userId);
    return {
      conversations: conversations.map((c: any) => ({
        id: c.id,
        title: c.title ?? undefined,
        messageCount: c._count?.messages ?? 0,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    };
  }

  @Delete("api/ai/conversations/:id")
  @UseGuards(HttpAuthGuard)
  async deleteConversationHttp(@Param("id") id: string, @CurrentUser() user: { userId: string }) {
    await this.conversationService.deleteConversation(id, user.userId);
    return {};
  }

  @Get("api/ai/conversations/:conversationId/messages")
  @UseGuards(HttpAuthGuard)
  async getConversationMessagesHttp(
    @Param("conversationId") conversationId: string,
    @CurrentUser() user: { userId: string },
  ) {
    const messages = await this.conversationService.getMessages(conversationId, user.userId);
    return {
      messages: messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  @Post("api/ai/embed")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async triggerEmbeddingHttp(@CurrentUser() user: { userId: string }) {
    const result = await this.prisma.document.updateMany({
      where: { userId: user.userId, deleted: false },
      data: { embedded: false },
    });
    await this.jobsService.enqueue("embedding-batch", { userId: user.userId });
    return { documentsQueued: result.count };
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/core-backend && npm test -- --testPathPattern=ai.controller.http
```

Expected: PASS (6 tests pass)

- [ ] **Step 5: Commit**

```bash
cd apps/core-backend && git add src/ai/ai.controller.ts src/ai/ai.controller.http.spec.ts
git commit -m "feat(backend): add REST AI endpoints (config, conversations, messages, embed)"
```

---

### Task 5: SSE Chat Streaming Endpoint

**Files:**
- Modify: `apps/core-backend/src/ai/ai.controller.ts`

No additional test for the SSE endpoint — it requires a live HTTP connection to test effectively. Covered by end-to-end validation in Phase 2.

- [ ] **Step 1: Add SSE sendMessage method to AiController**

Add the following method to `apps/core-backend/src/ai/ai.controller.ts` at the end of the class, after the `triggerEmbeddingHttp` method:

```typescript
  @Post("api/ai/conversations/:conversationId/messages")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async sendMessageHttp(
    @Param("conversationId") conversationId: string,
    @Body()
    body: {
      content: string;
      enabledCalendarIds?: string[];
      enabledIcsIds?: string[];
      timezone?: string;
    },
    @CurrentUser() user: { userId: string },
    @Req() req: any,
    @Res() res: any,
  ): Promise<void> {
    const { content, enabledCalendarIds = [], enabledIcsIds = [], timezone = "" } = body;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const writeEvent = (event: object) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    req.on("close", () => {
      this.agentService.abortActiveChatStream(user.userId);
    });

    try {
      const cfg = await this.aiConfigService.getConfig(user.userId);
      if (!cfg?.chatProvider?.trim() || !cfg?.chatModel?.trim()) {
        writeEvent({ type: "error", content: "Select a chat model in Settings before sending messages." });
        res.end();
        return;
      }

      const stream = this.agentService.streamResponse(
        user.userId,
        conversationId,
        content,
        writeEvent,
        enabledCalendarIds,
        enabledIcsIds,
        timezone,
      );

      for await (const event of stream) {
        writeEvent(event);
      }
    } catch (err: any) {
      const message = err instanceof Error ? err.message : "Stream failed";
      writeEvent({ type: "error", content: message });
    }

    res.end();
  }
```

- [ ] **Step 2: Verify the backend still compiles**

```bash
cd apps/core-backend && npm run build 2>&1 | tail -5
```

Expected: Build succeeds (no TypeScript errors)

- [ ] **Step 3: Commit**

```bash
cd apps/core-backend && git add src/ai/ai.controller.ts
git commit -m "feat(backend): add SSE chat streaming endpoint POST /api/ai/conversations/:id/messages"
```

---

### Task 6: REST Calendar Endpoints

**Files:**
- Modify: `apps/core-backend/src/calendar/calendar.controller.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/core-backend/src/calendar/calendar.controller.http.spec.ts`:

```typescript
import { Test, TestingModule } from "@fastify/testing";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { IcsService } from "./ics.service";
import { AuthSessionService } from "../auth/auth-session.service";
import { HttpAuthGuard } from "../auth/http-auth.guard";

describe("CalendarController HTTP endpoints", () => {
  let controller: CalendarController;
  let calendarService: jest.Mocked<Partial<CalendarService>>;
  let icsService: jest.Mocked<Partial<IcsService>>;

  const user = { userId: "u1" };

  beforeEach(async () => {
    calendarService = {
      getStatus: jest.fn().mockResolvedValue({ connected: false, providers: [] }),
      startOAuth: jest.fn().mockResolvedValue({ authorizationUrl: "https://oauth.example.com" }),
      disconnect: jest.fn().mockResolvedValue(undefined),
      listCalendars: jest.fn().mockResolvedValue([]),
      subscribe: jest.fn().mockResolvedValue({ id: "sub1" }),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      updateSubscription: jest.fn().mockResolvedValue({ id: "sub1" }),
      fetchEvents: jest.fn().mockResolvedValue([]),
      createEvent: jest.fn().mockResolvedValue({ id: "ev1" }),
      updateEvent: jest.fn().mockResolvedValue({ id: "ev1" }),
      deleteEvent: jest.fn().mockResolvedValue(undefined),
      rsvpEvent: jest.fn().mockResolvedValue(undefined),
    };
    icsService = {
      addSubscription: jest.fn().mockResolvedValue({ id: "ics1" }),
      removeSubscription: jest.fn().mockResolvedValue(undefined),
      updateSubscription: jest.fn().mockResolvedValue({ id: "ics1" }),
      fetchEvents: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CalendarController],
      providers: [
        { provide: CalendarService, useValue: calendarService },
        { provide: IcsService, useValue: icsService },
        { provide: AuthSessionService, useValue: {} },
        { provide: HttpAuthGuard, useValue: { canActivate: () => true } },
      ],
    })
      .overrideGuard(HttpAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CalendarController>(CalendarController);
  });

  it("getCalendarStatusHttp returns status", async () => {
    const result = await controller.getCalendarStatusHttp(user as any);
    expect(calendarService.getStatus).toHaveBeenCalledWith("u1");
    expect(result).toMatchObject({ connected: false });
  });

  it("fetchCalendarEventsHttp returns combined events", async () => {
    const result = await controller.fetchCalendarEventsHttp(
      "2024-01-01T00:00:00Z",
      "2024-01-31T23:59:59Z",
      user as any,
    );
    expect(result).toEqual({ events: [] });
  });

  it("createCalendarEventHttp creates event", async () => {
    const body = { subscriptionId: "sub1", title: "Meeting", startTime: "2024-01-15T10:00:00Z", endTime: "2024-01-15T11:00:00Z" };
    const result = await controller.createCalendarEventHttp(body, user as any);
    expect(result).toEqual({ event: { id: "ev1" } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/core-backend && npm test -- --testPathPattern=calendar.controller.http
```

Expected: FAIL with "controller.getCalendarStatusHttp is not a function"

- [ ] **Step 3: Add HTTP imports and REST methods to CalendarController**

In `apps/core-backend/src/calendar/calendar.controller.ts`, update imports at top to add:

```typescript
import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from "@fastify/common";
import { GrpcMethod, RpcException } from "@fastify/microservices";
import type { Metadata } from "@grpc/grpc-js";
import { status as GrpcStatus } from "@grpc/grpc-js";
import type { Response } from "express";
import { AuthSessionService } from "../auth/auth-session.service";
import { CalendarService } from "./calendar.service";
import { IcsService } from "./ics.service";
import { HttpAuthGuard } from "../auth/http-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
```

Then add these methods at the end of the `CalendarController` class (before closing `}`):

```typescript
  // ── REST: Calendar ──

  @Get("api/calendar/status")
  @UseGuards(HttpAuthGuard)
  async getCalendarStatusHttp(@CurrentUser() user: { userId: string }) {
    return this.calendarService.getStatus(user.userId);
  }

  @Post("api/calendar/oauth/start")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async startCalendarOAuthHttp(
    @Body() body: { providerId: string; redirectUri: string },
    @CurrentUser() user: { userId: string },
  ) {
    return this.calendarService.startOAuth(user.userId, body.providerId, body.redirectUri);
  }

  @Post("api/calendar/oauth/complete")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async completeCalendarOAuthHttp(
    @Body() body: { code: string; state: string; providerId: string; redirectUri: string },
    @CurrentUser() user: { userId: string },
  ) {
    const result = await this.calendarService.completeOAuth(
      body.code,
      body.state,
      body.providerId,
      user.userId,
      body.redirectUri,
    );
    return { connection: result };
  }

  @Post("api/calendar/disconnect")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async disconnectCalendarHttp(
    @Body() body: { connectionId: string },
    @CurrentUser() user: { userId: string },
  ) {
    await this.calendarService.disconnect(user.userId, body.connectionId);
    return {};
  }

  @Get("api/calendar/calendars")
  @UseGuards(HttpAuthGuard)
  async listCalendarsHttp(
    @Query("connectionId") connectionId: string,
    @CurrentUser() user: { userId: string },
  ) {
    const calendars = await this.calendarService.listCalendars(user.userId, connectionId);
    return { calendars };
  }

  @Post("api/calendar/subscribe")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async subscribeCalendarHttp(
    @Body() body: { connectionId: string; calendarId: string; name: string; color?: string },
    @CurrentUser() user: { userId: string },
  ) {
    const subscription = await this.calendarService.subscribe(
      user.userId,
      body.connectionId,
      body.calendarId,
      body.name,
      body.color ?? "#7c5cdc",
    );
    return { subscription };
  }

  @Delete("api/calendar/subscribe/:subscriptionId")
  @UseGuards(HttpAuthGuard)
  async unsubscribeCalendarHttp(
    @Param("subscriptionId") subscriptionId: string,
    @CurrentUser() user: { userId: string },
  ) {
    await this.calendarService.unsubscribe(user.userId, subscriptionId);
    return {};
  }

  @Patch("api/calendar/subscribe/:subscriptionId")
  @UseGuards(HttpAuthGuard)
  async updateCalendarSubscriptionHttp(
    @Param("subscriptionId") subscriptionId: string,
    @Body() body: { color?: string; enabled?: boolean },
    @CurrentUser() user: { userId: string },
  ) {
    const subscription = await this.calendarService.updateSubscription(
      user.userId,
      subscriptionId,
      body.color,
      body.enabled,
    );
    return { subscription };
  }

  @Post("api/calendar/ics")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async addIcsSubscriptionHttp(
    @Body() body: { url: string; name: string; color?: string },
    @CurrentUser() user: { userId: string },
  ) {
    const subscription = await this.icsService.addSubscription(
      user.userId,
      body.url,
      body.name,
      body.color ?? "#7c5cdc",
    );
    return { subscription };
  }

  @Delete("api/calendar/ics/:id")
  @UseGuards(HttpAuthGuard)
  async removeIcsSubscriptionHttp(@Param("id") id: string, @CurrentUser() user: { userId: string }) {
    await this.icsService.removeSubscription(user.userId, id);
    return {};
  }

  @Patch("api/calendar/ics/:id")
  @UseGuards(HttpAuthGuard)
  async updateIcsSubscriptionHttp(
    @Param("id") id: string,
    @Body() body: { name?: string; color?: string; enabled?: boolean },
    @CurrentUser() user: { userId: string },
  ) {
    const subscription = await this.icsService.updateSubscription(
      user.userId,
      id,
      body.name,
      body.color,
      body.enabled,
    );
    return { subscription };
  }

  @Get("api/calendar/events")
  @UseGuards(HttpAuthGuard)
  async fetchCalendarEventsHttp(
    @Query("timeMin") timeMin: string,
    @Query("timeMax") timeMax: string,
    @CurrentUser() user: { userId: string },
  ) {
    const [providerEvents, icsEvents] = await Promise.all([
      this.calendarService.fetchEvents(user.userId, timeMin, timeMax),
      this.icsService.fetchEvents(user.userId, timeMin, timeMax),
    ]);
    return { events: [...providerEvents, ...icsEvents] };
  }

  @Post("api/calendar/events")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async createCalendarEventHttp(
    @Body()
    body: {
      subscriptionId: string;
      title: string;
      description?: string;
      location?: string;
      startTime: string;
      endTime: string;
      allDay?: boolean;
    },
    @CurrentUser() user: { userId: string },
  ) {
    const event = await this.calendarService.createEvent(user.userId, body.subscriptionId, {
      title: body.title,
      description: body.description,
      location: body.location,
      startTime: body.startTime,
      endTime: body.endTime,
      allDay: body.allDay ?? false,
    });
    return { event };
  }

  @Patch("api/calendar/events/:eventId")
  @UseGuards(HttpAuthGuard)
  async updateCalendarEventHttp(
    @Param("eventId") eventId: string,
    @Body()
    body: {
      subscriptionId: string;
      title?: string;
      description?: string;
      location?: string;
      startTime?: string;
      endTime?: string;
      allDay?: boolean;
    },
    @CurrentUser() user: { userId: string },
  ) {
    const event = await this.calendarService.updateEvent(user.userId, body.subscriptionId, eventId, {
      title: body.title,
      description: body.description,
      location: body.location,
      startTime: body.startTime,
      endTime: body.endTime,
      allDay: body.allDay,
    });
    return { event };
  }

  @Delete("api/calendar/events/:eventId")
  @UseGuards(HttpAuthGuard)
  async deleteCalendarEventHttp(
    @Param("eventId") eventId: string,
    @Query("subscriptionId") subscriptionId: string,
    @CurrentUser() user: { userId: string },
  ) {
    await this.calendarService.deleteEvent(user.userId, subscriptionId, eventId);
    return {};
  }

  @Post("api/calendar/events/:eventId/rsvp")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async rsvpCalendarEventHttp(
    @Param("eventId") eventId: string,
    @Body() body: { subscriptionId: string; response: string },
    @CurrentUser() user: { userId: string },
  ) {
    await this.calendarService.rsvpEvent(user.userId, body.subscriptionId, eventId, body.response);
    return {};
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/core-backend && npm test -- --testPathPattern=calendar.controller.http
```

Expected: PASS (3 tests pass)

- [ ] **Step 5: Commit**

```bash
cd apps/core-backend && git add src/calendar/calendar.controller.ts src/calendar/calendar.controller.http.spec.ts
git commit -m "feat(backend): add REST calendar endpoints (status, OAuth, events, subscriptions)"
```

---

### Task 7: Full Build Verification

- [ ] **Step 1: Run all backend tests**

```bash
cd apps/core-backend && npm test 2>&1 | tail -20
```

Expected: All tests pass (no failures)

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
cd apps/core-backend && npm run build 2>&1 | tail -10
```

Expected: No TypeScript errors

- [ ] **Step 3: Smoke test the REST endpoints manually**

Start the backend (if not already running):
```bash
cd apps/core-backend && npm run start:dev
```

Test health endpoint:
```bash
curl http://localhost:4000/api/health
```
Expected: `{"ok":true}`

Test auth providers (no auth needed):
```bash
curl http://localhost:4000/api/auth/providers
```
Expected: JSON with providers array

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(backend): Phase 1 complete — REST + SSE API alongside gRPC"
```
