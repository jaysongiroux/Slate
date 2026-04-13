# RxDB Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all client-side storage (SQLite, Yjs, IndexedDB) and sync (Hocuspocus WebSocket) with RxDB + HTTP/SSE replication.

**Architecture:** Client-side RxDB in Electron renderer with three collections (notes, folders, settings). Server exposes pull/push/stream replication endpoints backed by Prisma/PostgreSQL. SSE for real-time change propagation. ProseMirror JSON stored as `content`, markdown materialized server-side via pg-boss worker.

**Tech Stack:** RxDB (free IndexedDB adapter), Fastify, Prisma, pg-boss, SSE, Tiptap

**Spec:** `docs/superpowers/specs/2026-04-10-rxdb-migration-design.md`

**Note:** User preference is no git commands during implementation. Commit at your discretion outside of agent execution.

---

## File Structure

### Server — New files

```
apps/core-backend/src/
  replication/
    replication.plugin.ts         # Fastify plugin, registers all replication routes
    sse-event-bus.ts              # In-memory EventEmitter for SSE change notifications
    conflict.ts                   # Conflict detection: compare assumedMasterState vs DB
    notes.replication.ts          # Pull/push/stream handlers for notes
    folders.replication.ts        # Pull/push/stream handlers for folders
    settings.replication.ts       # Pull/push/stream handlers for settings
  materialization/
    materialize.service.ts        # ProseMirror JSON -> markdown conversion
```

### Server — Modified files

```
packages/server-db/prisma/schema.prisma          # Add content/Folder/Setting, drop crdtState/plainText/serverSeq/DeviceCursor
apps/core-backend/src/server.ts                   # Replace collaboration plugin with replication plugin
apps/core-backend/src/plugins/services.ts         # Add materializeService, remove collaborationService/crdtService
apps/core-backend/src/routes/notes.ts             # Drop plainText, update CRUD for new schema
apps/core-backend/src/search/search.service.ts    # plainText -> markdown in FTS query
apps/core-backend/src/admin/adminjs-resources.ts  # Remove plainText/crdtState/serverSeq references
apps/core-backend/src/jobs/job-handlers.service.ts # Add materialize job handler
apps/core-backend/package.json                    # Remove hocuspocus/yjs deps
```

### Server — Deleted files

```
apps/core-backend/src/plugins/collaboration.ts
apps/core-backend/src/collaboration/collaboration.service.ts
apps/core-backend/src/collaboration/collaboration.service.spec.ts
apps/core-backend/src/documents/crdt.service.ts
apps/core-backend/src/documents/crdt.service.spec.ts   # if exists
```

### Client — New files

```
apps/desktop/src/db/
  database.ts                     # RxDB instance creation + collection registration
  schemas/
    note.schema.ts                # RxJsonSchema for notes collection
    folder.schema.ts              # RxJsonSchema for folders collection
    setting.schema.ts             # RxJsonSchema for settings collection
  replication.ts                  # Pull/push/SSE replication setup per collection
  conflict-handler.ts             # updatedAt wins, edit > delete
apps/desktop/src/hooks/
  use-notes.ts                    # Reactive RxDB queries for notes
  use-folders.ts                  # Reactive RxDB queries for folders
  use-settings.ts                 # Reactive RxDB queries for settings
apps/desktop/electron/services/
  config-store.mjs                # JSON file for auth tokens, backend URL
  pending-uploads.mjs             # JSON file queue for offline attachment uploads
```

### Client — Modified files

```
apps/desktop/src/components/NovelEditor.tsx       # Remove collaboration extension, add onUpdate -> RxDB save
apps/desktop/src/hooks/useNoteActions.ts          # Rewrite to use RxDB instead of IPC
apps/desktop/src/stores/workspace-store.ts        # Remove snapshot (RxDB is the source of truth)
apps/desktop/src/stores/sync-store.ts             # Simplify: remove auth fields, keep save/connection state
apps/desktop/electron/main.mjs                    # Remove SQLite IPC handlers, slim to config/attachments/window
apps/desktop/electron/preload.mjs                 # Slim exposed API
apps/desktop/package.json                         # Remove yjs/hocuspocus, add rxdb
```

### Client — Deleted files

```
apps/desktop/src/lib/sync-provider.tsx
apps/desktop/electron/services/metadata-store.mjs
apps/desktop/electron/services/metadata-store.test.mjs  # if exists
apps/desktop/electron/services/note-store.mjs
apps/desktop/electron/services/note-store.test.mjs
```

### Shared — Modified files

```
packages/shared/src/index.ts                      # Remove Yjs exports, remove plainText from types
packages/shared/package.json                      # Remove yjs/y-prosemirror deps
```

### Shared — Deleted files

```
packages/shared/src/tiptap-ydoc.ts
packages/shared/src/y-doc-content.ts
```

---

## Task 1: Prisma Schema Migration

**Files:**

- Modify: `packages/server-db/prisma/schema.prisma`

- [ ] **Step 1: Update Document model**

In `packages/server-db/prisma/schema.prisma`, replace the Document model (lines 75-97):

```prisma
model Document {
  id          String          @id @default(cuid())
  userId      String
  title       String
  path        String
  content     Json            @default("{}")
  markdown    String          @db.Text @default("")
  deleted     Boolean         @default(false)
  embedded    Boolean         @default(false)
  pinned      Boolean         @default(false)
  isTemplate  Boolean         @default(false)
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  user        User            @relation(fields: [userId], references: [id], onDelete: Restrict)
  attachments Attachment[]
  chunks      DocumentChunk[]

  @@unique([userId, path])
  @@index([userId, updatedAt])
  @@index([createdAt])
  @@map("document")
}
```

Changes from current:

- Added `content Json @default("{}")` (ProseMirror JSON)
- Added `isTemplate Boolean @default(false)`
- Removed `plainText String @db.Text`
- Removed `crdtState Bytes?`
- Removed `serverSeq BigInt @default(0)`
- Replaced `@@index([userId, serverSeq])` with `@@index([userId, updatedAt])`

- [ ] **Step 2: Remove DeviceCursor model**

Delete the DeviceCursor model (lines 190-203):

```prisma
// DELETE THIS ENTIRE BLOCK
model DeviceCursor {
  id            String   @id @default(cuid())
  userId        String
  clientId      String
  lastServerSeq BigInt   @default(0)
  updatedAt     DateTime @updatedAt
  user          User     @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@unique([userId, clientId])
  @@index([userId])
  @@index([clientId])
  @@index([updatedAt])
  @@map("device_cursor")
}
```

Also remove the `deviceCursors DeviceCursor[]` relation from the User model.

- [ ] **Step 3: Add Folder model**

Add after the Document model:

```prisma
model Folder {
  id        String   @id @default(cuid())
  userId    String
  path      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@unique([userId, path])
  @@index([userId, updatedAt])
  @@map("folder")
}
```

Add `folders Folder[]` relation to the User model.

- [ ] **Step 4: Add Setting model**

Add after the Folder model:

```prisma
model Setting {
  id        String   @id @default(cuid())
  userId    String
  key       String
  value     Json
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@unique([userId, key])
  @@index([userId, updatedAt])
  @@map("setting")
}
```

Add `settings Setting[]` relation to the User model.

- [ ] **Step 5: Generate and run migration**

Run:

```bash
cd packages/server-db && npx prisma migrate dev --name rxdb-migration
```

Expected: Migration creates, `plainText` and `crdtState` columns dropped, `content` column added, `device_cursor` table dropped, `folder` and `setting` tables created.

- [ ] **Step 6: Regenerate Prisma client**

Run:

```bash
cd packages/server-db && npx prisma generate
```

Expected: Types regenerate with new models. `Document.plainText`, `Document.crdtState`, `Document.serverSeq`, and `DeviceCursor` no longer exist in the generated types.

---

## Task 2: SSE Event Bus + Conflict Detection

**Files:**

- Create: `apps/core-backend/src/replication/sse-event-bus.ts`
- Create: `apps/core-backend/src/replication/conflict.ts`
- Create: `apps/core-backend/test/replication/conflict.spec.ts`

- [ ] **Step 1: Write the SSE event bus**

Create `apps/core-backend/src/replication/sse-event-bus.ts`:

```typescript
import { EventEmitter } from "node:events";

export interface ChangeEvent {
  collection: "notes" | "folders" | "settings";
  userId: string;
  documentId: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
}

export class SseEventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(1000);
  }

  publish(event: ChangeEvent): void {
    this.emitter.emit(`change:${event.collection}:${event.userId}`, event);
  }

  subscribe(
    collection: "notes" | "folders" | "settings",
    userId: string,
    listener: (event: ChangeEvent) => void,
  ): () => void {
    const key = `change:${collection}:${userId}`;
    this.emitter.on(key, listener);
    return () => {
      this.emitter.off(key, listener);
    };
  }
}
```

- [ ] **Step 2: Write the failing conflict detection test**

Create `apps/core-backend/test/replication/conflict.spec.ts`:

```typescript
import { detectConflict } from "../../src/replication/conflict";

describe("detectConflict", () => {
  const master = {
    id: "note1",
    title: "Server Title",
    updatedAt: "2026-04-10T12:00:00.000Z",
  };

  it("returns null when assumedMasterState matches current master", () => {
    const assumed = { ...master };
    expect(detectConflict(master, assumed)).toBeNull();
  });

  it("returns the master document when assumedMasterState differs", () => {
    const assumed = { ...master, title: "Stale Title" };
    expect(detectConflict(master, assumed)).toEqual(master);
  });

  it("returns null when both are null (new document)", () => {
    expect(detectConflict(null, null)).toBeNull();
  });

  it("returns master when assumed is null but master exists (created on another device)", () => {
    expect(detectConflict(master, null)).toEqual(master);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/core-backend && npx jest test/replication/conflict.spec.ts --verbose`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement conflict detection**

Create `apps/core-backend/src/replication/conflict.ts`:

```typescript
/**
 * Compare the client's assumed master state against the actual current master.
 * Returns null if no conflict, or the current master document if there is one.
 *
 * RxDB sends `assumedMasterState` with each push — the last version the client
 * saw from the server. If the server's current version differs, another device
 * has written in between, and we have a conflict.
 */
export function detectConflict<T extends Record<string, unknown>>(
  currentMaster: T | null,
  assumedMasterState: T | null,
): T | null {
  if (currentMaster === null && assumedMasterState === null) {
    return null;
  }
  if (currentMaster === null || assumedMasterState === null) {
    return currentMaster;
  }

  const masterJson = JSON.stringify(currentMaster);
  const assumedJson = JSON.stringify(assumedMasterState);

  if (masterJson === assumedJson) {
    return null;
  }

  return currentMaster;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/core-backend && npx jest test/replication/conflict.spec.ts --verbose`

Expected: All 4 tests PASS.

---

## Task 3: Notes Replication Endpoints

**Files:**

- Create: `apps/core-backend/src/replication/notes.replication.ts`
- Create: `apps/core-backend/test/replication/notes.replication.spec.ts`

- [ ] **Step 1: Write the failing test for notes pull**

Create `apps/core-backend/test/replication/notes.replication.spec.ts`:

```typescript
import { createTestApp, resetDatabase } from "../helpers/test-app";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let accessToken: string;
let userId: string;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(app);
  // Create a test user and get token
  const user = await app.prisma.user.create({
    data: { email: "test@test.com", displayName: "Test", isAdmin: false },
  });
  userId = user.id;
  const session = await app.authAdminService.createInternalAdminSession({
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    isAdmin: false,
  });
  accessToken = session.accessToken;
});

describe("POST /api/replication/notes/pull", () => {
  it("returns empty array when no documents exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/replication/notes/pull",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        checkpoint: null,
        limit: 100,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.documents).toEqual([]);
    expect(body.checkpoint).toBeNull();
  });

  it("returns documents after checkpoint", async () => {
    await app.prisma.document.create({
      data: {
        userId,
        title: "Note 1",
        path: "note-1",
        content: {},
        markdown: "",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/notes/pull",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        checkpoint: null,
        limit: 100,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].title).toBe("Note 1");
    expect(body.checkpoint).toBeTruthy();
    expect(body.checkpoint.id).toBe(body.documents[0].id);
    expect(body.checkpoint.updatedAt).toBeTruthy();
  });
});

describe("POST /api/replication/notes/push", () => {
  it("creates a new document on push", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/replication/notes/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: null,
            newDocumentState: {
              id: "new-note-1",
              title: "New Note",
              path: "new-note",
              content: { type: "doc", content: [] },
              pinned: false,
              deleted: false,
              isTemplate: false,
              updatedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.conflicts).toEqual([]);

    const doc = await app.prisma.document.findUnique({ where: { id: "new-note-1" } });
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("New Note");
  });

  it("returns conflict when assumedMasterState is stale", async () => {
    const doc = await app.prisma.document.create({
      data: {
        id: "existing-1",
        userId,
        title: "Original",
        path: "existing",
        content: {},
        markdown: "",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/notes/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: {
              id: "existing-1",
              title: "Stale Title",
              path: "existing",
              content: {},
              pinned: false,
              deleted: false,
              isTemplate: false,
              updatedAt: "2020-01-01T00:00:00.000Z",
              createdAt: doc.createdAt.toISOString(),
            },
            newDocumentState: {
              id: "existing-1",
              title: "Client Update",
              path: "existing",
              content: { type: "doc", content: [{ type: "paragraph" }] },
              pinned: false,
              deleted: false,
              isTemplate: false,
              updatedAt: new Date().toISOString(),
              createdAt: doc.createdAt.toISOString(),
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].title).toBe("Original");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/core-backend && npx jest test/replication/notes.replication.spec.ts --verbose`

Expected: FAIL — 404 on replication routes (not registered yet).

- [ ] **Step 3: Implement notes replication handlers**

Create `apps/core-backend/src/replication/notes.replication.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { SseEventBus } from "./sse-event-bus";
import { detectConflict } from "./conflict";

interface Checkpoint {
  id: string;
  updatedAt: string;
}

interface NoteDoc {
  id: string;
  title: string;
  path: string;
  content: unknown;
  pinned: boolean;
  deleted: boolean;
  isTemplate: boolean;
  updatedAt: string;
  createdAt: string;
}

function toNoteDoc(row: {
  id: string;
  title: string;
  path: string;
  content: unknown;
  pinned: boolean;
  deleted: boolean;
  isTemplate: boolean;
  updatedAt: Date;
  createdAt: Date;
}): NoteDoc {
  return {
    id: row.id,
    title: row.title,
    path: row.path,
    content: row.content,
    pinned: row.pinned,
    deleted: row.deleted,
    isTemplate: row.isTemplate,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function registerNotesReplication(fastify: FastifyInstance, eventBus: SseEventBus) {
  const auth = { preHandler: [fastify.authenticate] };

  // --- PULL ---
  fastify.post("/api/replication/notes/pull", auth, async (request) => {
    const { checkpoint, limit } = request.body as {
      checkpoint: Checkpoint | null;
      limit: number;
    };
    const userId = request.user!.userId;
    const batchSize = Math.min(limit || 100, 200);

    const where: Record<string, unknown> = { userId };

    if (checkpoint) {
      where.OR = [
        { updatedAt: { gt: new Date(checkpoint.updatedAt) } },
        {
          updatedAt: new Date(checkpoint.updatedAt),
          id: { gt: checkpoint.id },
        },
      ];
    }

    const rows = await fastify.prisma.document.findMany({
      where,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: batchSize,
      select: {
        id: true,
        title: true,
        path: true,
        content: true,
        pinned: true,
        deleted: true,
        isTemplate: true,
        updatedAt: true,
        createdAt: true,
      },
    });

    const documents = rows.map(toNoteDoc);
    const newCheckpoint =
      documents.length > 0
        ? {
            id: documents[documents.length - 1].id,
            updatedAt: documents[documents.length - 1].updatedAt,
          }
        : checkpoint;

    return { documents, checkpoint: newCheckpoint };
  });

  // --- PUSH ---
  fastify.post("/api/replication/notes/push", auth, async (request) => {
    const { changeRows } = request.body as {
      changeRows: Array<{
        assumedMasterState: NoteDoc | null;
        newDocumentState: NoteDoc;
      }>;
    };
    const userId = request.user!.userId;
    const conflicts: NoteDoc[] = [];

    for (const row of changeRows) {
      const { assumedMasterState, newDocumentState } = row;

      const currentMaster = await fastify.prisma.document.findFirst({
        where: { id: newDocumentState.id, userId },
        select: {
          id: true,
          title: true,
          path: true,
          content: true,
          pinned: true,
          deleted: true,
          isTemplate: true,
          updatedAt: true,
          createdAt: true,
        },
      });

      const masterDoc = currentMaster ? toNoteDoc(currentMaster) : null;
      const conflict = detectConflict(masterDoc, assumedMasterState);

      if (conflict) {
        conflicts.push(conflict);
        continue;
      }

      if (currentMaster) {
        await fastify.prisma.document.update({
          where: { id: newDocumentState.id },
          data: {
            title: newDocumentState.title,
            path: newDocumentState.path,
            content: newDocumentState.content as any,
            pinned: newDocumentState.pinned,
            deleted: newDocumentState.deleted,
            isTemplate: newDocumentState.isTemplate,
            embedded: false,
          },
        });
      } else {
        await fastify.prisma.document.create({
          data: {
            id: newDocumentState.id,
            userId,
            title: newDocumentState.title,
            path: newDocumentState.path,
            content: newDocumentState.content as any,
            markdown: "",
            pinned: newDocumentState.pinned,
            deleted: newDocumentState.deleted,
            isTemplate: newDocumentState.isTemplate,
          },
        });
      }

      eventBus.publish({
        collection: "notes",
        userId,
        documentId: newDocumentState.id,
        operation: currentMaster ? "UPDATE" : "INSERT",
      });

      // Enqueue materialization job
      if (fastify.jobsService) {
        await fastify.jobsService.enqueue("materialize", {
          documentId: newDocumentState.id,
          userId,
        });
      }
    }

    return { conflicts };
  });

  // --- STREAM (SSE) ---
  // Use authenticateAttachment (accepts ?token= query param) because EventSource can't set headers
  const streamAuth = { preHandler: [fastify.authenticateAttachment] };
  fastify.get("/api/replication/notes/stream", streamAuth, async (request, reply) => {
    const userId = request.user!.userId;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Send initial heartbeat
    reply.raw.write(":\n\n");

    const heartbeat = setInterval(() => {
      reply.raw.write(":\n\n");
    }, 30000);

    const unsubscribe = eventBus.subscribe("notes", userId, async (event) => {
      const doc = await fastify.prisma.document.findFirst({
        where: { id: event.documentId, userId },
        select: {
          id: true,
          title: true,
          path: true,
          content: true,
          pinned: true,
          deleted: true,
          isTemplate: true,
          updatedAt: true,
          createdAt: true,
        },
      });

      if (doc) {
        const data = JSON.stringify({
          documents: [toNoteDoc(doc)],
          checkpoint: {
            id: doc.id,
            updatedAt: doc.updatedAt.toISOString(),
          },
        });
        reply.raw.write(`data: ${data}\n\n`);
      }
    });

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
```

- [ ] **Step 4: Create the replication plugin to register routes**

Create `apps/core-backend/src/replication/replication.plugin.ts`:

```typescript
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { SseEventBus } from "./sse-event-bus";
import { registerNotesReplication } from "./notes.replication";
import { registerFoldersReplication } from "./folders.replication";
import { registerSettingsReplication } from "./settings.replication";

export default fp(async function replicationPlugin(fastify: FastifyInstance) {
  const eventBus = new SseEventBus();
  fastify.decorate("sseEventBus", eventBus);

  await registerNotesReplication(fastify, eventBus);
  await registerFoldersReplication(fastify, eventBus);
  await registerSettingsReplication(fastify, eventBus);
});
```

Note: `registerFoldersReplication` and `registerSettingsReplication` don't exist yet — create empty stubs that export async no-op functions so the plugin compiles. They are implemented in Task 4.

Temporary stubs (replace in Task 4):

Create `apps/core-backend/src/replication/folders.replication.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { SseEventBus } from "./sse-event-bus";

export async function registerFoldersReplication(
  _fastify: FastifyInstance,
  _eventBus: SseEventBus,
) {}
```

Create `apps/core-backend/src/replication/settings.replication.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { SseEventBus } from "./sse-event-bus";

export async function registerSettingsReplication(
  _fastify: FastifyInstance,
  _eventBus: SseEventBus,
) {}
```

- [ ] **Step 5: Register the replication plugin in server.ts**

In `apps/core-backend/src/server.ts`, add import and registration:

```typescript
import replicationPlugin from "./replication/replication.plugin";
```

Add after the `servicesPlugin` registration (line 47):

```typescript
await fastify.register(replicationPlugin);
```

Do NOT remove the `collaborationPlugin` import/registration yet — that happens in Task 9.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/core-backend && npx jest test/replication/notes.replication.spec.ts --verbose`

Expected: All tests PASS. If `createTestApp` doesn't pick up the replication plugin automatically, check that `server.ts` registers it and that the test helper builds from `server.ts`.

---

## Task 4: Folders + Settings Replication Endpoints

**Files:**

- Modify: `apps/core-backend/src/replication/folders.replication.ts`
- Modify: `apps/core-backend/src/replication/settings.replication.ts`
- Create: `apps/core-backend/test/replication/folders.replication.spec.ts`
- Create: `apps/core-backend/test/replication/settings.replication.spec.ts`

- [ ] **Step 1: Write failing test for folders pull**

Create `apps/core-backend/test/replication/folders.replication.spec.ts`:

```typescript
import { createTestApp, resetDatabase } from "../helpers/test-app";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let accessToken: string;
let userId: string;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(app);
  const user = await app.prisma.user.create({
    data: { email: "test@test.com", displayName: "Test", isAdmin: false },
  });
  userId = user.id;
  const session = await app.authAdminService.createInternalAdminSession({
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    isAdmin: false,
  });
  accessToken = session.accessToken;
});

describe("POST /api/replication/folders/pull", () => {
  it("returns folders for user", async () => {
    await app.prisma.folder.create({
      data: { userId, path: "journal" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/folders/pull",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { checkpoint: null, limit: 100 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].path).toBe("journal");
  });
});

describe("POST /api/replication/folders/push", () => {
  it("creates a new folder on push", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/replication/folders/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: null,
            newDocumentState: {
              id: "folder-1",
              path: "projects",
              updatedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.conflicts).toEqual([]);

    const folder = await app.prisma.folder.findUnique({ where: { id: "folder-1" } });
    expect(folder).not.toBeNull();
    expect(folder!.path).toBe("projects");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/core-backend && npx jest test/replication/folders.replication.spec.ts --verbose`

Expected: FAIL — routes return 404 (stubs are no-ops).

- [ ] **Step 3: Implement folders replication**

Replace `apps/core-backend/src/replication/folders.replication.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { SseEventBus } from "./sse-event-bus";
import { detectConflict } from "./conflict";

interface Checkpoint {
  id: string;
  updatedAt: string;
}

interface FolderDoc {
  id: string;
  path: string;
  updatedAt: string;
  createdAt: string;
}

function toFolderDoc(row: {
  id: string;
  path: string;
  updatedAt: Date;
  createdAt: Date;
}): FolderDoc {
  return {
    id: row.id,
    path: row.path,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function registerFoldersReplication(fastify: FastifyInstance, eventBus: SseEventBus) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.post("/api/replication/folders/pull", auth, async (request) => {
    const { checkpoint, limit } = request.body as {
      checkpoint: Checkpoint | null;
      limit: number;
    };
    const userId = request.user!.userId;
    const batchSize = Math.min(limit || 100, 200);

    const where: Record<string, unknown> = { userId };
    if (checkpoint) {
      where.OR = [
        { updatedAt: { gt: new Date(checkpoint.updatedAt) } },
        {
          updatedAt: new Date(checkpoint.updatedAt),
          id: { gt: checkpoint.id },
        },
      ];
    }

    const rows = await fastify.prisma.folder.findMany({
      where,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: batchSize,
    });

    const documents = rows.map(toFolderDoc);
    const newCheckpoint =
      documents.length > 0
        ? {
            id: documents[documents.length - 1].id,
            updatedAt: documents[documents.length - 1].updatedAt,
          }
        : checkpoint;

    return { documents, checkpoint: newCheckpoint };
  });

  fastify.post("/api/replication/folders/push", auth, async (request) => {
    const { changeRows } = request.body as {
      changeRows: Array<{
        assumedMasterState: FolderDoc | null;
        newDocumentState: FolderDoc;
      }>;
    };
    const userId = request.user!.userId;
    const conflicts: FolderDoc[] = [];

    for (const row of changeRows) {
      const { assumedMasterState, newDocumentState } = row;

      const currentMaster = await fastify.prisma.folder.findFirst({
        where: { id: newDocumentState.id, userId },
      });

      const masterDoc = currentMaster ? toFolderDoc(currentMaster) : null;
      const conflict = detectConflict(masterDoc, assumedMasterState);

      if (conflict) {
        conflicts.push(conflict);
        continue;
      }

      if (currentMaster) {
        await fastify.prisma.folder.update({
          where: { id: newDocumentState.id },
          data: { path: newDocumentState.path },
        });
      } else {
        await fastify.prisma.folder.create({
          data: {
            id: newDocumentState.id,
            userId,
            path: newDocumentState.path,
          },
        });
      }

      eventBus.publish({
        collection: "folders",
        userId,
        documentId: newDocumentState.id,
        operation: currentMaster ? "UPDATE" : "INSERT",
      });
    }

    return { conflicts };
  });

  // Use authenticateAttachment for SSE (EventSource can't set headers, uses ?token= query param)
  const streamAuth = { preHandler: [fastify.authenticateAttachment] };
  fastify.get("/api/replication/folders/stream", streamAuth, async (request, reply) => {
    const userId = request.user!.userId;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    reply.raw.write(":\n\n");

    const heartbeat = setInterval(() => {
      reply.raw.write(":\n\n");
    }, 30000);

    const unsubscribe = eventBus.subscribe("folders", userId, async (event) => {
      const folder = await fastify.prisma.folder.findFirst({
        where: { id: event.documentId, userId },
      });

      if (folder) {
        const data = JSON.stringify({
          documents: [toFolderDoc(folder)],
          checkpoint: {
            id: folder.id,
            updatedAt: folder.updatedAt.toISOString(),
          },
        });
        reply.raw.write(`data: ${data}\n\n`);
      }
    });

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
```

- [ ] **Step 4: Run folders test**

Run: `cd apps/core-backend && npx jest test/replication/folders.replication.spec.ts --verbose`

Expected: All tests PASS.

- [ ] **Step 5: Write failing test for settings**

Create `apps/core-backend/test/replication/settings.replication.spec.ts`:

```typescript
import { createTestApp, resetDatabase } from "../helpers/test-app";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let accessToken: string;
let userId: string;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(app);
  const user = await app.prisma.user.create({
    data: { email: "test@test.com", displayName: "Test", isAdmin: false },
  });
  userId = user.id;
  const session = await app.authAdminService.createInternalAdminSession({
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    isAdmin: false,
  });
  accessToken = session.accessToken;
});

describe("POST /api/replication/settings/push", () => {
  it("creates a new setting on push", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/replication/settings/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: null,
            newDocumentState: {
              id: "setting-1",
              key: "keyboardShortcuts",
              value: { "ctrl+s": "save" },
              updatedAt: new Date().toISOString(),
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.conflicts).toEqual([]);

    const setting = await app.prisma.setting.findUnique({ where: { id: "setting-1" } });
    expect(setting).not.toBeNull();
    expect(setting!.key).toBe("keyboardShortcuts");
  });
});
```

- [ ] **Step 6: Implement settings replication**

Replace `apps/core-backend/src/replication/settings.replication.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { SseEventBus } from "./sse-event-bus";
import { detectConflict } from "./conflict";

interface Checkpoint {
  id: string;
  updatedAt: string;
}

interface SettingDoc {
  id: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

function toSettingDoc(row: {
  id: string;
  key: string;
  value: unknown;
  updatedAt: Date;
}): SettingDoc {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function registerSettingsReplication(fastify: FastifyInstance, eventBus: SseEventBus) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.post("/api/replication/settings/pull", auth, async (request) => {
    const { checkpoint, limit } = request.body as {
      checkpoint: Checkpoint | null;
      limit: number;
    };
    const userId = request.user!.userId;
    const batchSize = Math.min(limit || 100, 200);

    const where: Record<string, unknown> = { userId };
    if (checkpoint) {
      where.OR = [
        { updatedAt: { gt: new Date(checkpoint.updatedAt) } },
        {
          updatedAt: new Date(checkpoint.updatedAt),
          id: { gt: checkpoint.id },
        },
      ];
    }

    const rows = await fastify.prisma.setting.findMany({
      where,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: batchSize,
    });

    const documents = rows.map(toSettingDoc);
    const newCheckpoint =
      documents.length > 0
        ? {
            id: documents[documents.length - 1].id,
            updatedAt: documents[documents.length - 1].updatedAt,
          }
        : checkpoint;

    return { documents, checkpoint: newCheckpoint };
  });

  fastify.post("/api/replication/settings/push", auth, async (request) => {
    const { changeRows } = request.body as {
      changeRows: Array<{
        assumedMasterState: SettingDoc | null;
        newDocumentState: SettingDoc;
      }>;
    };
    const userId = request.user!.userId;
    const conflicts: SettingDoc[] = [];

    for (const row of changeRows) {
      const { assumedMasterState, newDocumentState } = row;

      const currentMaster = await fastify.prisma.setting.findFirst({
        where: { id: newDocumentState.id, userId },
      });

      const masterDoc = currentMaster ? toSettingDoc(currentMaster) : null;
      const conflict = detectConflict(masterDoc, assumedMasterState);

      if (conflict) {
        conflicts.push(conflict);
        continue;
      }

      if (currentMaster) {
        await fastify.prisma.setting.update({
          where: { id: newDocumentState.id },
          data: {
            key: newDocumentState.key,
            value: newDocumentState.value as any,
          },
        });
      } else {
        await fastify.prisma.setting.create({
          data: {
            id: newDocumentState.id,
            userId,
            key: newDocumentState.key,
            value: newDocumentState.value as any,
          },
        });
      }

      eventBus.publish({
        collection: "settings",
        userId,
        documentId: newDocumentState.id,
        operation: currentMaster ? "UPDATE" : "INSERT",
      });
    }

    return { conflicts };
  });

  // Use authenticateAttachment for SSE (EventSource can't set headers, uses ?token= query param)
  const streamAuth = { preHandler: [fastify.authenticateAttachment] };
  fastify.get("/api/replication/settings/stream", streamAuth, async (request, reply) => {
    const userId = request.user!.userId;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    reply.raw.write(":\n\n");

    const heartbeat = setInterval(() => {
      reply.raw.write(":\n\n");
    }, 30000);

    const unsubscribe = eventBus.subscribe("settings", userId, async (event) => {
      const setting = await fastify.prisma.setting.findFirst({
        where: { id: event.documentId, userId },
      });

      if (setting) {
        const data = JSON.stringify({
          documents: [toSettingDoc(setting)],
          checkpoint: {
            id: setting.id,
            updatedAt: setting.updatedAt.toISOString(),
          },
        });
        reply.raw.write(`data: ${data}\n\n`);
      }
    });

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
```

- [ ] **Step 7: Run all replication tests**

Run: `cd apps/core-backend && npx jest test/replication/ --verbose`

Expected: All tests PASS across conflict, notes, folders, and settings specs.

---

## Task 5: Materialization Service + pg-boss Job

**Files:**

- Create: `apps/core-backend/src/materialization/materialize.service.ts`
- Create: `apps/core-backend/src/materialization/materialize.service.spec.ts`
- Modify: `apps/core-backend/src/jobs/job-handlers.service.ts`
- Modify: `apps/core-backend/src/plugins/services.ts`

- [ ] **Step 1: Write failing test for materialize service**

Create `apps/core-backend/src/materialization/materialize.service.spec.ts`:

```typescript
import { MaterializeService } from "./materialize.service";

describe("MaterializeService", () => {
  it("converts ProseMirror JSON to markdown", () => {
    const service = new MaterializeService();
    const content = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Hello World" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "This is a test." }],
        },
      ],
    };

    const markdown = service.toMarkdown(content);
    expect(markdown).toContain("# Hello World");
    expect(markdown).toContain("This is a test.");
  });

  it("returns empty string for empty doc", () => {
    const service = new MaterializeService();
    const content = { type: "doc", content: [] };

    const markdown = service.toMarkdown(content);
    expect(markdown).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/core-backend && npx jest src/materialization/materialize.service.spec.ts --verbose`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement materialize service**

Create `apps/core-backend/src/materialization/materialize.service.ts`:

```typescript
import { Node as ProsemirrorNode } from "prosemirror-model";
import { slateSchema, slateMarkdownSerializer, toTiptapJson } from "@slate/shared";

export class MaterializeService {
  /**
   * Convert ProseMirror JSON (Tiptap format) to markdown.
   * Uses the shared Slate schema and serializer.
   */
  toMarkdown(content: Record<string, unknown>): string {
    try {
      // Normalize to Slate backend schema if needed
      const normalized = toTiptapJson(content);
      const node = ProsemirrorNode.fromJSON(slateSchema, normalized);
      return slateMarkdownSerializer.serialize(node);
    } catch {
      return "";
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/core-backend && npx jest src/materialization/materialize.service.spec.ts --verbose`

Expected: All tests PASS. If the shared schema normalization doesn't work as expected with this input shape, adjust `toTiptapJson` usage or call `normalizeProsemirrorJsonForSlateSchema` from shared. The key contract is: ProseMirror JSON in, markdown string out.

- [ ] **Step 5: Register materialize service in services plugin**

In `apps/core-backend/src/plugins/services.ts`, add:

```typescript
import { MaterializeService } from "../materialization/materialize.service";
```

Inside the plugin function, create and decorate:

```typescript
const materializeService = new MaterializeService();
fastify.decorate("materializeService", materializeService);
```

- [ ] **Step 6: Add materialize job handler**

In `apps/core-backend/src/jobs/job-handlers.service.ts`, add a new worker registration alongside existing workers:

```typescript
await boss.work("materialize", { teamSize: 2 }, async (job) => {
  const { documentId, userId } = job.data as { documentId: string; userId: string };
  const log = fastify.log.child({ job: "materialize", documentId });

  const doc = await fastify.prisma.document.findFirst({
    where: { id: documentId, userId },
    select: { id: true, content: true, markdown: true, embedded: true },
  });

  if (!doc) {
    log.warn("Document not found, skipping materialization");
    return;
  }

  const newMarkdown = fastify.materializeService.toMarkdown(doc.content as Record<string, unknown>);

  if (newMarkdown !== doc.markdown) {
    await fastify.prisma.document.update({
      where: { id: documentId },
      data: { markdown: newMarkdown, embedded: false },
    });

    log.info("Materialized markdown, queuing re-embedding");
    await boss.send("search-index", { documentId, userId });
  } else {
    log.info("Markdown unchanged, skipping re-embedding");
  }
});
```

- [ ] **Step 7: Run full test suite to verify no regressions**

Run: `cd apps/core-backend && npx jest --verbose`

Expected: All existing tests pass (some may need adjustment if they reference `plainText` or `crdtState` — those fixes come in Tasks 6 and 9).

---

## Task 6: Search Service, AdminJS, and Notes Route Cleanup

**Files:**

- Modify: `apps/core-backend/src/search/search.service.ts`
- Modify: `apps/core-backend/src/admin/adminjs-resources.ts`
- Modify: `apps/core-backend/src/routes/notes.ts`

- [ ] **Step 1: Update search service**

In `apps/core-backend/src/search/search.service.ts`, replace `"plainText"` with `"markdown"` in both places (lines 15 and 19):

Line 15 — change:

```typescript
ts_rank(to_tsvector('english', coalesce(title, '') || ' ' || coalesce("plainText", '')), plainto_tsquery('english', ${query})) AS rank
```

to:

```typescript
ts_rank(to_tsvector('english', coalesce(title, '') || ' ' || coalesce("markdown", '')), plainto_tsquery('english', ${query})) AS rank
```

Line 19 — change:

```typescript
AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce("plainText", '')) @@ plainto_tsquery('english', ${query})
```

to:

```typescript
AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce("markdown", '')) @@ plainto_tsquery('english', ${query})
```

- [ ] **Step 2: Update AdminJS resource config**

In `apps/core-backend/src/admin/adminjs-resources.ts`, update the Document resource:

In `listProperties` array (~line 311), remove `"serverSeq"`.

In `showProperties` array (~line 320), remove `"plainText"` and `"serverSeq"`. Add `"content"` if you want JSON viewable in admin.

In `properties` object (~line 332), remove:

```typescript
plainText: { components: { show: plainTextComponent } },
```

- [ ] **Step 3: Update notes routes**

In `apps/core-backend/src/routes/notes.ts`:

In the POST `/api/notes` handler (line 33), remove `plainText: ""` from the create data. Add `content: {}`:

```typescript
data: {
  userId: request.user!.userId,
  path: body.path,
  title: body.title,
  content: {},
  markdown: "",
},
```

In the PATCH `/api/notes/:id` handler (line 48), remove the `plainText` field from the body type and the conditional spread. Remove lines 54 and 63-65 that reference `plainText`:

```typescript
const body = request.body as {
  path?: string;
  title?: string;
  deleted?: boolean;
  pinned?: boolean;
};
return fastify.prisma.document.update({
  where: { id, userId: request.user!.userId },
  data: {
    ...(body.path !== undefined ? { path: body.path } : {}),
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.deleted !== undefined ? { deleted: body.deleted } : {}),
    ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
  },
});
```

In the import route (line 87), update the bootstrap call. The old code calls `fastify.crdtService.bootstrapFromMarkdown()`. Replace with a direct create that stores content as empty JSON and materializes later:

```typescript
// Old: const { crdtState, markdown, plainText } = fastify.crdtService.bootstrapFromMarkdown(...)
// New: store markdown directly, content can be empty (or parsed from markdown if needed)
await fastify.prisma.document.create({
  data: {
    id: note.id || undefined,
    userId: request.user!.userId,
    path: note.path,
    title: note.title,
    content: {},
    markdown: note.markdown || "",
  },
});
```

- [ ] **Step 4: Run backend tests**

Run: `cd apps/core-backend && npx jest --verbose`

Expected: Tests that reference `plainText` or `crdtState` will fail — those are cleaned up in Task 9 when we remove the old collaboration/CRDT code and their tests.

---

## Task 7: Remove Server-Side Hocuspocus/Yjs Code

**Files:**

- Delete: `apps/core-backend/src/plugins/collaboration.ts`
- Delete: `apps/core-backend/src/collaboration/collaboration.service.ts`
- Delete: `apps/core-backend/src/collaboration/collaboration.service.spec.ts`
- Delete: `apps/core-backend/src/documents/crdt.service.ts`
- Delete: `apps/core-backend/src/documents/crdt.service.spec.ts` (if exists)
- Modify: `apps/core-backend/src/server.ts`
- Modify: `apps/core-backend/src/plugins/services.ts`
- Modify: `apps/core-backend/src/documents/documents.service.ts`
- Modify: `apps/core-backend/test/documents.spec.ts`

- [ ] **Step 1: Remove collaboration plugin from server.ts**

In `apps/core-backend/src/server.ts`, remove the import of `collaborationPlugin` and its `fastify.register(collaborationPlugin)` line (line 48).

- [ ] **Step 2: Remove collaboration service and CRDT service from services plugin**

In `apps/core-backend/src/plugins/services.ts`:

Remove imports for `CollaborationService` and `CrdtService`.

Remove their instantiation and `fastify.decorate("collaborationService", ...)` and `fastify.decorate("crdtService", ...)` lines.

- [ ] **Step 3: Update documents service**

In `apps/core-backend/src/documents/documents.service.ts`, remove all methods that depend on CRDT:

- `pushDocumentUpdate()` — this used `crdtService.mergeUpdate()`. Remove the method entirely. The replication endpoints replace this.
- `pullDocumentEvents()` — this used `DeviceCursor` and `serverSeq`. Remove entirely.
- `getDocumentSnapshot()` — if it returns `crdtState`, remove or simplify to return `content` instead.

Keep any methods that are still used by AI tools (check `create-note.tool.ts` and `edit-note.tool.ts`). If they call `pushDocumentUpdate`, rewrite them to use `fastify.prisma.document.update()` directly with the new schema.

- [ ] **Step 4: Delete old files**

Delete these files:

- `apps/core-backend/src/plugins/collaboration.ts`
- `apps/core-backend/src/collaboration/collaboration.service.ts`
- `apps/core-backend/src/collaboration/collaboration.service.spec.ts`
- `apps/core-backend/src/documents/crdt.service.ts`
- Any `crdt.service.spec.ts` if it exists

- [ ] **Step 5: Update existing tests**

In `apps/core-backend/test/documents.spec.ts`, remove or rewrite tests that use `crdtService`, `pushDocumentUpdate`, `pullDocumentEvents`, `serverSeq`, or `DeviceCursor`. The replication tests from Tasks 3-4 cover the new sync behavior.

Check for any other test files that reference removed services and update them.

- [ ] **Step 6: Remove server dependencies**

In `apps/core-backend/package.json`, remove:

```json
"@hocuspocus/extension-database": "^3.4.4",
"@hocuspocus/server": "^3.4.4",
"yjs": "^13.6.30",
"y-prosemirror": "^1.3.7",
"y-protocols": "^1.0.7"
```

Run: `cd apps/core-backend && npm install`

Note: `prosemirror-model` and `prosemirror-*` packages must stay — they're used by the materialization service via `@slate/shared`.

- [ ] **Step 7: Run full backend test suite**

Run: `cd apps/core-backend && npx jest --verbose`

Expected: All tests PASS. No references to removed code remain.

---

## Task 8: Shared Package Cleanup

**Files:**

- Delete: `packages/shared/src/tiptap-ydoc.ts`
- Delete: `packages/shared/src/y-doc-content.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`

- [ ] **Step 1: Remove Yjs exports from index.ts**

In `packages/shared/src/index.ts`, remove the `extractTiptapContentFromYDoc` export and any other Yjs-related exports.

Remove from the type exports:

- Any types that reference `SyncState` if it's only used for Yjs sync (check if anything still imports it)
- `LocalDocumentRecord.plainText` field — remove from the type definition

- [ ] **Step 2: Delete Yjs utility files**

Delete:

- `packages/shared/src/tiptap-ydoc.ts`
- `packages/shared/src/y-doc-content.ts`

- [ ] **Step 3: Remove Yjs dependencies from shared package**

In `packages/shared/package.json`, remove:

```json
"y-prosemirror": "^1.3.7",
"yjs": "^13.6.30"
```

Run: `cd packages/shared && npm install`

- [ ] **Step 4: Build shared package**

Run: `cd packages/shared && npm run build`

Expected: Build succeeds with no references to deleted files.

- [ ] **Step 5: Run shared tests**

Run: `cd packages/shared && npm test`

Expected: `vitest run` passes. Any tests that referenced Yjs utilities should have been in the deleted files.

---

## Task 9: RxDB Database Setup + Collection Schemas (Client)

**Files:**

- Create: `apps/desktop/src/db/schemas/note.schema.ts`
- Create: `apps/desktop/src/db/schemas/folder.schema.ts`
- Create: `apps/desktop/src/db/schemas/setting.schema.ts`
- Create: `apps/desktop/src/db/database.ts`

- [ ] **Step 1: Install RxDB**

In `apps/desktop/package.json`, add:

```json
"rxdb": "^16.12.0"
```

Run: `cd apps/desktop && npm install`

Note: Check https://rxdb.info/install.html for the latest version. The dexie storage plugin is included in the `rxdb` package as `rxdb/plugins/storage-dexie`.

- [ ] **Step 2: Create note schema**

Create `apps/desktop/src/db/schemas/note.schema.ts`:

```typescript
import type { RxJsonSchema } from "rxdb";

export interface NoteDocType {
  id: string;
  title: string;
  path: string;
  content: Record<string, unknown>;
  pinned: boolean;
  deleted: boolean;
  isTemplate: boolean;
  updatedAt: string;
  createdAt: string;
}

export const noteSchema: RxJsonSchema<NoteDocType> = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    title: { type: "string" },
    path: { type: "string" },
    content: { type: "object" },
    pinned: { type: "boolean" },
    deleted: { type: "boolean" },
    isTemplate: { type: "boolean" },
    updatedAt: { type: "string", format: "date-time", maxLength: 50 },
    createdAt: { type: "string", format: "date-time", maxLength: 50 },
  },
  required: [
    "id",
    "title",
    "path",
    "content",
    "pinned",
    "deleted",
    "isTemplate",
    "updatedAt",
    "createdAt",
  ],
  indexes: ["updatedAt", "path", ["deleted", "updatedAt"]],
};
```

- [ ] **Step 3: Create folder schema**

Create `apps/desktop/src/db/schemas/folder.schema.ts`:

```typescript
import type { RxJsonSchema } from "rxdb";

export interface FolderDocType {
  id: string;
  path: string;
  updatedAt: string;
  createdAt: string;
}

export const folderSchema: RxJsonSchema<FolderDocType> = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    path: { type: "string" },
    updatedAt: { type: "string", format: "date-time", maxLength: 50 },
    createdAt: { type: "string", format: "date-time", maxLength: 50 },
  },
  required: ["id", "path", "updatedAt", "createdAt"],
  indexes: ["updatedAt", "path"],
};
```

- [ ] **Step 4: Create setting schema**

Create `apps/desktop/src/db/schemas/setting.schema.ts`:

```typescript
import type { RxJsonSchema } from "rxdb";

export interface SettingDocType {
  id: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

export const settingSchema: RxJsonSchema<SettingDocType> = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    key: { type: "string" },
    value: {},
    updatedAt: { type: "string", format: "date-time", maxLength: 50 },
  },
  required: ["id", "key", "updatedAt"],
  indexes: ["updatedAt", "key"],
};
```

- [ ] **Step 5: Create database initialization**

Create `apps/desktop/src/db/database.ts`:

```typescript
import { createRxDatabase, type RxDatabase } from "rxdb";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { noteSchema, type NoteDocType } from "./schemas/note.schema";
import { folderSchema, type FolderDocType } from "./schemas/folder.schema";
import { settingSchema, type SettingDocType } from "./schemas/setting.schema";
import type { RxCollection } from "rxdb";

export type SlateCollections = {
  notes: RxCollection<NoteDocType>;
  folders: RxCollection<FolderDocType>;
  settings: RxCollection<SettingDocType>;
};

export type SlateDatabase = RxDatabase<SlateCollections>;

let dbPromise: Promise<SlateDatabase> | null = null;

export function getDatabase(): Promise<SlateDatabase> {
  if (!dbPromise) {
    dbPromise = createDatabase();
  }
  return dbPromise;
}

async function createDatabase(): Promise<SlateDatabase> {
  const db = await createRxDatabase<SlateCollections>({
    name: "slatedb",
    storage: getRxStorageDexie(),
    ignoreDuplicate: true,
  });

  await db.addCollections({
    notes: { schema: noteSchema },
    folders: { schema: folderSchema },
    settings: { schema: settingSchema },
  });

  return db;
}

/**
 * Destroy the database instance. Used for cleanup/testing.
 */
export async function destroyDatabase(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    await db.destroy();
    dbPromise = null;
  }
}
```

- [ ] **Step 6: Verify it compiles**

Run: `cd apps/desktop && npx tsc --noEmit`

Expected: No type errors from the new db files. If there are RxDB type issues, check that the rxdb version exports `RxJsonSchema`, `RxDatabase`, `RxCollection` as expected.

---

## Task 10: RxDB Replication Client + Conflict Handler

**Files:**

- Create: `apps/desktop/src/db/conflict-handler.ts`
- Create: `apps/desktop/src/db/replication.ts`

- [ ] **Step 1: Create conflict handler**

Create `apps/desktop/src/db/conflict-handler.ts`:

```typescript
import type { RxConflictHandler, RxConflictHandlerInput } from "rxdb";
import type { NoteDocType } from "./schemas/note.schema";

/**
 * Conflict resolution for notes:
 * - Latest updatedAt wins
 * - Edits always win over deletes (a deleted note that was edited reappears)
 */
export const noteConflictHandler: RxConflictHandler<NoteDocType> = {
  isEqual(a: NoteDocType, b: NoteDocType): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  },
  resolve(input: RxConflictHandlerInput<NoteDocType>): Promise<{
    isEqual: boolean;
    documentData: NoteDocType;
  }> {
    const { newDocumentState, realMasterState } = input;

    // Edit wins over delete
    if (realMasterState.deleted && !newDocumentState.deleted) {
      return Promise.resolve({
        isEqual: false,
        documentData: newDocumentState,
      });
    }
    if (!realMasterState.deleted && newDocumentState.deleted) {
      return Promise.resolve({
        isEqual: false,
        documentData: realMasterState,
      });
    }

    // Latest updatedAt wins
    const masterTime = new Date(realMasterState.updatedAt).getTime();
    const localTime = new Date(newDocumentState.updatedAt).getTime();

    const winner = localTime >= masterTime ? newDocumentState : realMasterState;
    return Promise.resolve({
      isEqual: false,
      documentData: winner,
    });
  },
};
```

- [ ] **Step 2: Create replication setup**

Create `apps/desktop/src/db/replication.ts`:

```typescript
import { replicateRxCollection } from "rxdb/plugins/replication";
import type { RxCollection, RxReplicationState } from "rxdb";
import { Subject } from "rxjs";
import type { SlateDatabase } from "./database";
import { noteConflictHandler } from "./conflict-handler";

interface ReplicationConfig {
  backendUrl: string;
  getToken: () => Promise<string>;
}

interface Checkpoint {
  id: string;
  updatedAt: string;
}

/**
 * Set up replication for all collections in the database.
 * Returns a cleanup function that cancels all replications.
 */
export function setupReplication(db: SlateDatabase, config: ReplicationConfig): () => void {
  const replications: RxReplicationState<any, Checkpoint>[] = [];

  replications.push(setupCollectionReplication(db.notes, "notes", config, noteConflictHandler));
  replications.push(setupCollectionReplication(db.folders, "folders", config));
  replications.push(setupCollectionReplication(db.settings, "settings", config));

  return () => {
    replications.forEach((r) => r.cancel());
  };
}

function setupCollectionReplication<T>(
  collection: RxCollection<T>,
  collectionName: string,
  config: ReplicationConfig,
  conflictHandler?: any,
): RxReplicationState<T, Checkpoint> {
  const pullStream$ = new Subject<{
    documents: T[];
    checkpoint: Checkpoint;
  }>();

  // SSE connection for live updates
  let eventSource: EventSource | null = null;

  async function connectSSE() {
    const token = await config.getToken();
    const url = `${config.backendUrl}/api/replication/${collectionName}/stream?token=${encodeURIComponent(token)}`;

    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        pullStream$.next(data);
      } catch {
        // Ignore parse errors from heartbeats
      }
    };

    eventSource.onerror = () => {
      // EventSource auto-reconnects; we just need to handle cleanup
      if (eventSource?.readyState === EventSource.CLOSED) {
        // Reconnect after a delay
        setTimeout(() => connectSSE(), 5000);
      }
    };
  }

  connectSSE();

  const replication = replicateRxCollection<T, Checkpoint>({
    collection,
    replicationIdentifier: `slate-${collectionName}-replication`,
    live: true,
    retryTime: 5000,
    ...(conflictHandler ? { conflictHandler } : {}),

    push: {
      batchSize: 50,
      async handler(changeRows) {
        const token = await config.getToken();
        const response = await fetch(
          `${config.backendUrl}/api/replication/${collectionName}/push`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ changeRows }),
          },
        );

        if (!response.ok) {
          throw new Error(`Push failed: ${response.status}`);
        }

        const result = await response.json();
        return result.conflicts || [];
      },
    },

    pull: {
      batchSize: 100,
      async handler(lastCheckpoint: Checkpoint | null, batchSize: number) {
        const token = await config.getToken();
        const response = await fetch(
          `${config.backendUrl}/api/replication/${collectionName}/pull`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              checkpoint: lastCheckpoint,
              limit: batchSize,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`Pull failed: ${response.status}`);
        }

        return response.json();
      },
      stream$: pullStream$.asObservable(),
    },
  });

  // Clean up SSE on replication cancel
  const originalCancel = replication.cancel.bind(replication);
  replication.cancel = () => {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    pullStream$.complete();
    return originalCancel();
  };

  return replication;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/desktop && npx tsc --noEmit`

Expected: No type errors. If RxDB's `replicateRxCollection` API differs from what's shown (check the installed version's types), adjust the handler signatures to match.

---

## Task 11: React Hooks for RxDB

**Files:**

- Create: `apps/desktop/src/hooks/use-notes.ts`
- Create: `apps/desktop/src/hooks/use-folders.ts`
- Create: `apps/desktop/src/hooks/use-settings.ts`

- [ ] **Step 1: Create use-notes hook**

Create `apps/desktop/src/hooks/use-notes.ts`:

```typescript
import { useState, useEffect } from "react";
import type { NoteDocType } from "../db/schemas/note.schema";
import type { SlateDatabase } from "../db/database";

/**
 * Reactive query for all non-deleted notes, sorted by updatedAt descending.
 */
export function useNotes(db: SlateDatabase | null) {
  const [notes, setNotes] = useState<NoteDocType[]>([]);

  useEffect(() => {
    if (!db) return;

    const sub = db.notes
      .find({
        selector: { deleted: false },
        sort: [{ updatedAt: "desc" }],
      })
      .$.subscribe((docs) => {
        setNotes(docs.map((d) => d.toJSON()));
      });

    return () => sub.unsubscribe();
  }, [db]);

  return notes;
}

/**
 * Reactive query for a single note by ID.
 */
export function useNote(db: SlateDatabase | null, noteId: string | null) {
  const [note, setNote] = useState<NoteDocType | null>(null);

  useEffect(() => {
    if (!db || !noteId) {
      setNote(null);
      return;
    }

    const sub = db.notes.findOne({ selector: { id: noteId } }).$.subscribe((doc) => {
      setNote(doc ? doc.toJSON() : null);
    });

    return () => sub.unsubscribe();
  }, [db, noteId]);

  return note;
}

/**
 * Reactive query for template notes.
 */
export function useTemplates(db: SlateDatabase | null) {
  const [templates, setTemplates] = useState<NoteDocType[]>([]);

  useEffect(() => {
    if (!db) return;

    const sub = db.notes
      .find({
        selector: { isTemplate: true, deleted: false },
        sort: [{ updatedAt: "desc" }],
      })
      .$.subscribe((docs) => {
        setTemplates(docs.map((d) => d.toJSON()));
      });

    return () => sub.unsubscribe();
  }, [db]);

  return templates;
}
```

- [ ] **Step 2: Create use-folders hook**

Create `apps/desktop/src/hooks/use-folders.ts`:

```typescript
import { useState, useEffect } from "react";
import type { FolderDocType } from "../db/schemas/folder.schema";
import type { SlateDatabase } from "../db/database";

/**
 * Reactive query for all folders, sorted by path.
 */
export function useFolders(db: SlateDatabase | null) {
  const [folders, setFolders] = useState<FolderDocType[]>([]);

  useEffect(() => {
    if (!db) return;

    const sub = db.folders.find({ sort: [{ path: "asc" }] }).$.subscribe((docs) => {
      setFolders(docs.map((d) => d.toJSON()));
    });

    return () => sub.unsubscribe();
  }, [db]);

  return folders;
}
```

- [ ] **Step 3: Create use-settings hook**

Create `apps/desktop/src/hooks/use-settings.ts`:

```typescript
import { useState, useEffect, useCallback } from "react";
import type { SettingDocType } from "../db/schemas/setting.schema";
import type { SlateDatabase } from "../db/database";

/**
 * Reactive query for a single setting by key.
 * Returns [value, setter] like useState.
 */
export function useSetting<T = unknown>(
  db: SlateDatabase | null,
  key: string,
  defaultValue: T,
): [T, (value: T) => Promise<void>] {
  const [value, setValue] = useState<T>(defaultValue);

  useEffect(() => {
    if (!db) return;

    const sub = db.settings.findOne({ selector: { key } }).$.subscribe((doc) => {
      if (doc) {
        setValue(doc.value as T);
      } else {
        setValue(defaultValue);
      }
    });

    return () => sub.unsubscribe();
  }, [db, key, defaultValue]);

  const updateValue = useCallback(
    async (newValue: T) => {
      if (!db) return;

      await db.settings.upsert({
        id: `setting-${key}`,
        key,
        value: newValue as any,
        updatedAt: new Date().toISOString(),
      });
    },
    [db, key],
  );

  return [value, updateValue];
}

/**
 * Reactive query for keyboard shortcuts specifically.
 */
export function useKeyboardShortcuts(db: SlateDatabase | null) {
  return useSetting<Record<string, string>>(db, "keyboardShortcuts", {});
}
```

- [ ] **Step 4: Verify compilation**

Run: `cd apps/desktop && npx tsc --noEmit`

Expected: No type errors.

---

## Task 12: Editor Integration (Tiptap -> RxDB)

**Files:**

- Modify: `apps/desktop/src/components/NovelEditor.tsx`
- Modify: `apps/desktop/src/hooks/useNoteActions.ts`

- [ ] **Step 1: Update NovelEditor to remove collaboration extension**

In `apps/desktop/src/components/NovelEditor.tsx`:

Remove imports:

```typescript
// DELETE these imports
import Collaboration from "@tiptap/extension-collaboration";
```

In the editor extensions array, remove the `Collaboration` extension entry. It looks something like:

```typescript
// DELETE this from the extensions array
Collaboration.configure({
  document: ydoc,
}),
```

The editor should now be a standalone Tiptap instance with no Yjs binding.

- [ ] **Step 2: Add onUpdate handler for RxDB saves**

In NovelEditor.tsx, add an `onUpdate` prop or use the existing editor update callback. The editor should save to RxDB on content change, debounced:

Add a debounced save inside the editor setup:

```typescript
import { useRef, useCallback } from "react";
import { getDatabase } from "../db/database";

// Inside the component:
const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const handleEditorUpdate = useCallback(
  ({ editor }: { editor: any }) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(async () => {
      if (!noteId) return;

      const json = editor.getJSON();
      const title = deriveDocumentTitle(json);
      const db = await getDatabase();

      await db.notes.upsert({
        id: noteId,
        title,
        path: notePath,
        content: json,
        pinned: note?.pinned ?? false,
        deleted: false,
        isTemplate: note?.isTemplate ?? false,
        updatedAt: new Date().toISOString(),
        createdAt: note?.createdAt ?? new Date().toISOString(),
      });

      useSyncStore.getState().setSaveState("saved");
    }, 500);
  },
  [noteId, notePath, note],
);
```

Wire this into the Tiptap editor's `onUpdate` callback.

- [ ] **Step 3: Update editor content loading**

The editor should load content from RxDB instead of from Yjs. When `noteId` changes, fetch the note from RxDB and set the editor content:

```typescript
useEffect(() => {
  if (!editor || !noteId) return;

  (async () => {
    const db = await getDatabase();
    const doc = await db.notes.findOne({ selector: { id: noteId } }).exec();
    if (doc && doc.content) {
      editor.commands.setContent(doc.content);
    } else {
      editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] });
    }
  })();
}, [editor, noteId]);
```

- [ ] **Step 4: Update useNoteActions**

In `apps/desktop/src/hooks/useNoteActions.ts`, rewrite to use RxDB instead of IPC:

Remove imports of `saveNote`, `updateNotePlainText`, `loadNote` from the IPC API.

Replace the `persistNote` function:

```typescript
import { getDatabase } from "../db/database";

async function persistNote(note: LocalNoteSummary) {
  try {
    const db = await getDatabase();
    await db.notes.upsert({
      id: note.id,
      title: note.title,
      path: note.path,
      content: note.content ?? {},
      pinned: note.pinned ?? false,
      deleted: false,
      isTemplate: note.isTemplate ?? false,
      updatedAt: new Date().toISOString(),
      createdAt: note.createdAt ?? new Date().toISOString(),
    });

    useSyncStore.getState().setSaveState("saved");
  } catch (error) {
    useSyncStore.getState().setSaveState("error");
    console.error("Failed to save note:", error);
  }
}
```

Replace `loadNote` with an RxDB query:

```typescript
async function loadNoteFromDb(noteId: string) {
  const db = await getDatabase();
  const doc = await db.notes.findOne({ selector: { id: noteId } }).exec();
  return doc ? doc.toJSON() : null;
}
```

- [ ] **Step 5: Verify compilation**

Run: `cd apps/desktop && npx tsc --noEmit`

Expected: Type errors may appear in components that still reference the old SyncProvider or IPC methods. These are fixed in Task 14.

---

## Task 13: Main Process Slim-Down

**Files:**

- Create: `apps/desktop/electron/services/config-store.mjs`
- Create: `apps/desktop/electron/services/pending-uploads.mjs`
- Modify: `apps/desktop/electron/main.mjs`
- Modify: `apps/desktop/electron/preload.mjs`

- [ ] **Step 1: Create config store**

Create `apps/desktop/electron/services/config-store.mjs`:

```javascript
import fs from "node:fs";
import path from "node:path";

export class ConfigStore {
  #filePath;
  #data;

  constructor(userDataPath) {
    fs.mkdirSync(userDataPath, { recursive: true });
    this.#filePath = path.join(userDataPath, "config.json");
    this.#data = this.#load();
  }

  #load() {
    try {
      return JSON.parse(fs.readFileSync(this.#filePath, "utf-8"));
    } catch {
      return {};
    }
  }

  #save() {
    fs.writeFileSync(this.#filePath, JSON.stringify(this.#data, null, 2));
  }

  get(key) {
    return this.#data[key] ?? null;
  }

  set(key, value) {
    this.#data[key] = value;
    this.#save();
  }

  delete(key) {
    delete this.#data[key];
    this.#save();
  }

  getAll() {
    return { ...this.#data };
  }
}
```

- [ ] **Step 2: Create pending uploads queue**

Create `apps/desktop/electron/services/pending-uploads.mjs`:

```javascript
import fs from "node:fs";
import path from "node:path";

export class PendingUploads {
  #filePath;
  #stagingDir;
  #queue;

  constructor(userDataPath) {
    this.#stagingDir = path.join(userDataPath, "pending-attachments");
    fs.mkdirSync(this.#stagingDir, { recursive: true });
    this.#filePath = path.join(userDataPath, "pending-uploads.json");
    this.#queue = this.#load();
  }

  #load() {
    try {
      return JSON.parse(fs.readFileSync(this.#filePath, "utf-8"));
    } catch {
      return [];
    }
  }

  #save() {
    fs.writeFileSync(this.#filePath, JSON.stringify(this.#queue, null, 2));
  }

  get stagingDir() {
    return this.#stagingDir;
  }

  add(entry) {
    this.#queue.push({
      ...entry,
      retries: 0,
      createdAt: new Date().toISOString(),
    });
    this.#save();
  }

  list() {
    return [...this.#queue];
  }

  remove(id) {
    this.#queue = this.#queue.filter((e) => e.id !== id);
    this.#save();
  }

  incrementRetries(id) {
    const entry = this.#queue.find((e) => e.id === id);
    if (entry) {
      entry.retries += 1;
      this.#save();
    }
  }
}
```

- [ ] **Step 3: Update main.mjs — replace MetadataStore with ConfigStore**

In `apps/desktop/electron/main.mjs`:

Replace the import and instantiation of `MetadataStore` and `NoteStore` with `ConfigStore` and `PendingUploads`:

```javascript
// OLD:
// import { MetadataStore } from "./services/metadata-store.mjs";
// import { NoteStore } from "./services/note-store.mjs";
// const metadataStore = new MetadataStore(userDataPath);
// const noteStore = new NoteStore(metadataStore);

// NEW:
import { ConfigStore } from "./services/config-store.mjs";
import { PendingUploads } from "./services/pending-uploads.mjs";
const configStore = new ConfigStore(userDataPath);
const pendingUploads = new PendingUploads(userDataPath);
```

- [ ] **Step 4: Remove all note/folder/settings IPC handlers from main.mjs**

Remove IPC handlers for:

- `desktop:createNote`, `desktop:createDailyNote`, `desktop:loadNote`, `desktop:saveNote`, `desktop:deleteNote`, `desktop:renameNote`, `desktop:togglePinNote`, `desktop:rescanNote`, `desktop:updateNotePlainText`
- `desktop:createFolder`, `desktop:renameFolder`, `desktop:moveFolder`, `desktop:deleteFolder`
- `desktop:getSnapshot`
- `desktop:getLastOpenNoteId`, `desktop:setLastOpenNoteId`, `desktop:getLastSidebarMode`, `desktop:setLastSidebarMode`
- `desktop:getKeyboardShortcuts`, `desktop:setKeyboardShortcut`
- `desktop:getNoteCrdtState`

Keep IPC handlers for:

- `desktop:setBackendEndpoint`, `desktop:checkBackendConnection`, `desktop:refreshBackendStatus`
- `desktop:loginWithPassword`, `desktop:loginWithOidc`, `desktop:signOutBackend`, `desktop:connectBackend`
- `desktop:uploadAttachment`, `desktop:resolveAttachmentUrl`
- Any window management handlers
- Calendar IPC handlers (these are REST API pass-through, stay as-is)
- AI chat IPC handlers (REST API pass-through, stay as-is)

Update the auth-related handlers to use `configStore` instead of `metadataStore` for token storage:

```javascript
// Example: loginWithPassword handler
ipcMain.handle("desktop:loginWithPassword", async (_, email, password) => {
  const endpoint = configStore.get("backendEndpoint");
  const result = await httpClient.loginWithPassword(endpoint, email, password);
  configStore.set("accessToken", result.accessToken);
  configStore.set("refreshToken", result.refreshToken);
  configStore.set("tokenExpiresAtUnix", result.expiresAtUnix);
  return result;
});
```

- [ ] **Step 5: Update the pending attachment handler**

Update the offline attachment fallback in main.mjs to use `pendingUploads` instead of `metadataStore`:

```javascript
// In the uploadAttachment handler, the offline fallback:
const id = crypto.randomUUID();
const localPath = path.join(pendingUploads.stagingDir, `${id}-${fileName}`);
fs.writeFileSync(localPath, buffer);
pendingUploads.add({
  id,
  fileName,
  mimeType,
  localPath,
  documentId,
});
return { id, contentUrl: `/api/attachments/pending/${id}/content`, pending: true };
```

- [ ] **Step 6: Update preload.mjs**

In `apps/desktop/electron/preload.mjs`, remove all IPC method exposures that were deleted from main.mjs. Keep only:

```javascript
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("slateDesktop", {
  // Config
  getConfig: (key) => ipcRenderer.invoke("desktop:getConfig", key),
  setConfig: (key, value) => ipcRenderer.invoke("desktop:setConfig", key, value),

  // Auth
  setBackendEndpoint: (url) => ipcRenderer.invoke("desktop:setBackendEndpoint", url),
  checkBackendConnection: (url) => ipcRenderer.invoke("desktop:checkBackendConnection", url),
  loginWithPassword: (email, password) =>
    ipcRenderer.invoke("desktop:loginWithPassword", email, password),
  loginWithOidc: (providerId) => ipcRenderer.invoke("desktop:loginWithOidc", providerId),
  signOutBackend: () => ipcRenderer.invoke("desktop:signOutBackend"),

  // Attachments
  uploadAttachment: (payload) => ipcRenderer.invoke("desktop:uploadAttachment", payload),
  resolveAttachmentUrl: (contentUrl) =>
    ipcRenderer.invoke("desktop:resolveAttachmentUrl", contentUrl),
  listPendingUploads: () => ipcRenderer.invoke("desktop:listPendingUploads"),
  retryPendingUploads: () => ipcRenderer.invoke("desktop:retryPendingUploads"),

  // Calendar (pass-through to REST, stays in main for auth token injection)
  // ... keep all existing calendar IPC methods ...

  // AI Chat (pass-through to REST, stays in main for auth token injection)
  // ... keep all existing AI chat IPC methods ...

  // Window management
  // ... keep existing window management methods ...
});
```

- [ ] **Step 7: Add config IPC handlers in main.mjs**

```javascript
ipcMain.handle("desktop:getConfig", (_, key) => {
  return configStore.get(key);
});

ipcMain.handle("desktop:setConfig", (_, key, value) => {
  configStore.set(key, value);
});

ipcMain.handle("desktop:listPendingUploads", () => {
  return pendingUploads.list();
});
```

---

## Task 14: Wire Up Components + Remove Old Sync

**Files:**

- Delete: `apps/desktop/src/lib/sync-provider.tsx`
- Delete: `apps/desktop/electron/services/metadata-store.mjs`
- Delete: `apps/desktop/electron/services/note-store.mjs`
- Delete: `apps/desktop/electron/services/metadata-store.test.mjs` (if exists)
- Delete: `apps/desktop/electron/services/note-store.test.mjs`
- Modify: `apps/desktop/src/App.tsx` (or equivalent root component)
- Modify: Various components that import SyncProvider or old IPC methods

- [ ] **Step 1: Create a DatabaseProvider context**

Create or add to a top-level provider that initializes RxDB and replication:

```typescript
// In apps/desktop/src/db/DatabaseProvider.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getDatabase, type SlateDatabase } from "./database";
import { setupReplication } from "./replication";

const DatabaseContext = createContext<SlateDatabase | null>(null);

export function useDatabase(): SlateDatabase | null {
  return useContext(DatabaseContext);
}

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<SlateDatabase | null>(null);

  useEffect(() => {
    let cleanup: (() => void) | null = null;

    (async () => {
      const database = await getDatabase();
      setDb(database);

      // Set up replication if backend is configured
      const api = (window as any).slateDesktop;
      const backendUrl = await api?.getConfig("backendEndpoint");
      const token = await api?.getConfig("accessToken");

      if (backendUrl && token) {
        cleanup = setupReplication(database, {
          backendUrl,
          getToken: async () => {
            return await api.getConfig("accessToken");
          },
        });
      }
    })();

    return () => {
      cleanup?.();
    };
  }, []);

  return (
    <DatabaseContext.Provider value={db}>{children}</DatabaseContext.Provider>
  );
}
```

- [ ] **Step 2: Replace SyncProvider with DatabaseProvider in App.tsx**

In the root App component, replace `<SyncProvider>` with `<DatabaseProvider>`:

```typescript
// OLD:
// <SyncProvider noteId={selectedNoteId} backendUrl={...} getToken={...}>
//   ...
// </SyncProvider>

// NEW:
import { DatabaseProvider } from "./db/DatabaseProvider";

// In the render:
<DatabaseProvider>
  <AppShell>
    {/* ... */}
  </AppShell>
</DatabaseProvider>
```

- [ ] **Step 3: Update components that consume SyncProvider context**

Search for all imports of `useSyncContext` or `SyncProvider` and replace with RxDB hooks:

```typescript
// OLD:
// const { ydoc, isReady, isSynced, isConnected } = useSyncContext();

// NEW:
const db = useDatabase();
// isReady = db !== null
// isSynced / isConnected = from sync-store (replication status)
```

- [ ] **Step 4: Update workspace store**

In `apps/desktop/src/stores/workspace-store.ts`, the `snapshot` field held the full note list from the main process. With RxDB, the note list comes from the `useNotes` hook reactively. Remove `snapshot` and `setSnapshot` from the store. Components that read `snapshot.notes` should use `useNotes(db)` instead.

Keep: `selectedNote`, `setSelectedNote`, `appLoading`, `errorMessage`, `collapsedPaths`, `selectedItems`.

- [ ] **Step 5: Delete old files**

Delete:

- `apps/desktop/src/lib/sync-provider.tsx`
- `apps/desktop/electron/services/metadata-store.mjs`
- `apps/desktop/electron/services/metadata-store.test.mjs` (if exists)
- `apps/desktop/electron/services/note-store.mjs`
- `apps/desktop/electron/services/note-store.test.mjs`

- [ ] **Step 6: Update IPC API layer**

In `apps/desktop/src/lib/api/`, remove or gut the files that wrapped note/folder/settings IPC calls:

- `notes-api.ts` — Remove or simplify. Note CRUD is now RxDB direct.
- `ipc-core.ts` — Remove all note/folder/settings method declarations. Keep auth, calendar, AI, and attachment methods.

- [ ] **Step 7: Verify compilation**

Run: `cd apps/desktop && npx tsc --noEmit`

Expected: Compilation may have errors from components that still reference old APIs. Fix each one by replacing IPC calls with RxDB operations via `useDatabase()` hook.

---

## Task 15: Client Dependency Cleanup

**Files:**

- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Remove old dependencies**

In `apps/desktop/package.json`, remove:

```json
"@hocuspocus/provider": "^3.4.4",
"@tiptap/extension-collaboration": "...",
"y-indexeddb": "^9.0.12",
"y-prosemirror": "^1.3.7",
"y-protocols": "^1.0.7",
"yjs": "^13.6.30"
```

- [ ] **Step 2: Install**

Run: `cd apps/desktop && npm install`

Expected: No missing dependency errors for remaining code. If any file still imports a removed package, it needs to be updated (should have been caught in Task 14 Step 7).

- [ ] **Step 3: Full build check**

Run: `cd apps/desktop && npm run build`

Expected: Build succeeds with no references to removed packages.

---

## Task 16: Integration Verification

- [ ] **Step 1: Run all backend tests**

Run: `cd apps/core-backend && npx jest --verbose`

Expected: All tests pass. Replication, materialization, search, and existing auth/calendar/AI tests all green.

- [ ] **Step 2: Run shared package tests**

Run: `cd packages/shared && npm test`

Expected: All tests pass.

- [ ] **Step 3: Run desktop tests**

Run: `cd apps/desktop && npm test`

Expected: Tests pass (note-store tests were deleted, metadata-store tests were deleted). Remaining tests should pass.

- [ ] **Step 4: Build all packages**

Run: `npm run build` (from repo root)

Expected: All workspaces build successfully.

- [ ] **Step 5: Manual smoke test**

Start the backend:

```bash
cd apps/core-backend && npm run dev
```

Start the desktop app:

```bash
cd apps/desktop && npm run dev
```

Verify:

1. App launches without errors
2. Can create a new note — appears in RxDB (check DevTools > Application > IndexedDB > slatedb)
3. Editor saves content on typing (debounced)
4. Can create folders
5. Note appears in PostgreSQL after replication push
6. Markdown column populated after materialization job runs
7. Attachments still upload and display in notes
8. Search finds notes by content
9. Settings persist across app restart
