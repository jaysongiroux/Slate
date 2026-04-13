# Hocuspocus Sync Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace custom push/pull CRDT sync with Hocuspocus WebSocket sync, replace Milkdown editor with Novel, keep markdown files on disk as a readable projection, and support offline-first editing via y-indexeddb.

**Architecture:** Hocuspocus server embedded in the existing Fastify backend (port 4000) handles all document sync over WebSocket. Desktop Electron renderer uses HocuspocusProvider + y-indexeddb for online/offline sync. Novel (TipTap) replaces Milkdown as the editor. A chokidar file watcher in the Electron main process detects external `.md` edits and either prompts the user or auto-reconciles.

**Tech Stack:** Hocuspocus (server + provider), Novel, TipTap, Yjs, y-indexeddb, chokidar, Fastify WebSocket adapter, Prisma/PostgreSQL

**Spec:** `docs/superpowers/specs/2026-04-06-hocuspocus-sync-redesign.md`

---

## File Structure

### New Files

- `apps/core-backend/src/collaboration/collaboration.module.ts` — Fastify module for Hocuspocus
- `apps/core-backend/src/collaboration/collaboration.gateway.ts` — WebSocket gateway embedding Hocuspocus
- `apps/core-backend/src/collaboration/collaboration.service.ts` — onLoadDocument/onStoreDocument/onAuthenticate hooks
- `apps/core-backend/src/collaboration/collaboration.gateway.spec.ts` — tests for gateway + hooks
- `apps/desktop/src/components/NovelEditor.tsx` — Novel editor component replacing MilkdownEditor
- `apps/desktop/src/lib/sync-provider.tsx` — React context providing HocuspocusProvider + y-indexeddb per document
- `apps/desktop/electron/services/file-watcher.mjs` — chokidar-based external edit detection + reconciliation
- `apps/desktop/electron/services/file-watcher.test.mjs` — tests for file watcher

### Modified Files

- `apps/core-backend/src/app.module.ts` — import CollaborationModule
- `apps/core-backend/src/main.ts` — no changes needed (Fastify handles WebSocket adapter)
- `apps/core-backend/package.json` — add @hocuspocus/server
- `apps/desktop/package.json` — add novel, @hocuspocus/provider, y-indexeddb; remove @milkdown/_, @grpc/_
- `apps/desktop/electron/main.mjs` — remove sync-service/ydoc-manager/backend-client wiring, add file-watcher, simplify IPC
- `apps/desktop/electron/preload.mjs` — remove CRDT IPC methods, add file-conflict IPC
- `apps/desktop/electron/services/metadata-store.mjs` — drop notes table + CRDT columns, keep settings/auth/attachments
- `apps/desktop/src/App.tsx` — replace YDocProvider + MilkdownEditor with SyncProvider + NovelEditor
- `apps/desktop/src/components/SettingsDialog.tsx` — add auto-reconcile toggle
- `apps/desktop/src/styles.css` — remove all Milkdown CSS
- `packages/server-db/prisma/schema.prisma` — remove DeviceCursor model, remove serverSeq/embedded from Document

### Deleted Files

- `apps/desktop/electron/services/sync-service.mjs`
- `apps/desktop/electron/services/sync-service.test.mjs`
- `apps/desktop/electron/services/ydoc-manager.mjs`
- `apps/desktop/electron/services/backend-client.mjs`
- `apps/desktop/electron/services/sync-logger.mjs`
- `apps/desktop/electron/services/sync-intervals.mjs`
- `apps/desktop/electron/services/disk-content-hash.mjs`
- `apps/desktop/electron/services/workspace-disk-reconcile.mjs`
- `apps/desktop/src/components/MilkdownEditor.tsx`
- `apps/desktop/src/lib/ydoc-context.tsx`
- `apps/core-backend/src/documents/crdt.service.ts` (functionality absorbed into collaboration.service)
- `apps/core-backend/src/documents/documents.controller.ts` (gRPC sync endpoints replaced by WebSocket)

---

## Task 1: Install Dependencies

**Files:**

- Modify: `apps/core-backend/package.json`
- Modify: `apps/desktop/package.json`
- Modify: `package-lock.json` (auto-generated)

- [ ] **Step 1: Add backend dependencies**

```bash
cd /Users/jason/Desktop/git/slate/apps/core-backend && npm install @hocuspocus/server @hocuspocus/extension-database @fastify/websockets @fastify/platform-ws
```

- [ ] **Step 2: Add desktop dependencies**

```bash
cd /Users/jason/Desktop/git/slate/apps/desktop && npm install novel @hocuspocus/provider y-indexeddb @tiptap/extension-collaboration tiptap-markdown chokidar
```

- [ ] **Step 3: Remove old desktop dependencies**

```bash
cd /Users/jason/Desktop/git/slate/apps/desktop && npm uninstall @milkdown/core @milkdown/ctx @milkdown/plugin-clipboard @milkdown/plugin-history @milkdown/plugin-prism @milkdown/plugin-slash @milkdown/preset-commonmark @milkdown/preset-gfm @milkdown/prose @milkdown/utils @grpc/grpc-js @grpc/proto-loader
```

- [ ] **Step 4: Verify install succeeds**

Run: `cd /Users/jason/Desktop/git/slate && npm install`
Expected: Clean install with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/core-backend/package.json apps/desktop/package.json package-lock.json
git commit -m "deps: add hocuspocus, novel, y-indexeddb; remove milkdown, grpc"
```

---

## Task 2: Prisma Schema — Remove DeviceCursor and serverSeq

**Files:**

- Modify: `packages/server-db/prisma/schema.prisma`
- Test: Run `npx prisma generate` to verify

- [ ] **Step 1: Remove DeviceCursor model from schema**

In `packages/server-db/prisma/schema.prisma`, delete the entire `DeviceCursor` model:

```prisma
// DELETE THIS ENTIRE BLOCK:
model DeviceCursor {
  id            String   @id @default(cuid())
  userId        String
  clientId      String
  lastServerSeq BigInt   @default(0)
  updatedAt     DateTime @updatedAt

  @@unique([userId, clientId])
}
```

- [ ] **Step 2: Remove serverSeq and embedded from Document model**

In the `Document` model, remove these fields:

```prisma
// DELETE these lines from the Document model:
  serverSeq BigInt   @default(0)
  embedded  Boolean  @default(false)
```

Also remove the `serverSeq` from the index:

```prisma
// CHANGE this:
  @@index([userId, serverSeq])
// TO this:
  @@index([userId])
```

- [ ] **Step 3: Generate Prisma client and create migration**

Run: `cd /Users/jason/Desktop/git/slate/packages/server-db && npx prisma generate`
Expected: "Generated Prisma Client" with no errors.

Then create and apply migration:

```bash
cd /Users/jason/Desktop/git/slate/packages/server-db && npx prisma migrate dev --name remove-device-cursor-and-server-seq
```

Expected: Migration created and applied successfully.

- [ ] **Step 4: Commit**

```bash
git add packages/server-db/prisma/
git commit -m "schema: remove DeviceCursor model and serverSeq from Document"
```

---

## Task 3: Backend — Collaboration Module with Hocuspocus

**Files:**

- Create: `apps/core-backend/src/collaboration/collaboration.module.ts`
- Create: `apps/core-backend/src/collaboration/collaboration.service.ts`
- Create: `apps/core-backend/src/collaboration/collaboration.gateway.ts`
- Create: `apps/core-backend/src/collaboration/collaboration.gateway.spec.ts`
- Modify: `apps/core-backend/src/app.module.ts`

- [ ] **Step 1: Write tests for the collaboration service**

Create `apps/core-backend/src/collaboration/collaboration.gateway.spec.ts`:

```typescript
import { Test, TestingModule } from "@fastify/testing";
import { CollaborationService } from "./collaboration.service";
import { PrismaService } from "@slate/server-db";
import * as Y from "yjs";

describe("CollaborationService", () => {
  let service: CollaborationService;
  let prisma: { document: { findFirst: jest.Mock; upsert: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      document: {
        findFirst: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CollaborationService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(CollaborationService);
  });

  describe("onLoadDocument", () => {
    it("applies existing crdtState to the Y.Doc", async () => {
      const ydoc = new Y.Doc();
      ydoc.getXmlFragment("default").insert(0, [new Y.XmlText("hello")]);
      const state = Buffer.from(Y.encodeStateAsUpdate(ydoc));

      prisma.document.findFirst.mockResolvedValue({
        id: "doc1",
        crdtState: state,
      });

      const doc = new Y.Doc();
      await service.handleLoadDocument(doc, "doc1", "user1");

      const text = doc.getXmlFragment("default").toString();
      expect(text).toContain("hello");
      expect(prisma.document.findFirst).toHaveBeenCalledWith({
        where: { id: "doc1", userId: "user1" },
        select: { crdtState: true },
      });
    });

    it("returns empty Y.Doc when no document exists", async () => {
      prisma.document.findFirst.mockResolvedValue(null);

      const doc = new Y.Doc();
      await service.handleLoadDocument(doc, "doc1", "user1");

      // Doc should remain empty — no error thrown
      expect(doc.getXmlFragment("default").length).toBe(0);
    });
  });

  describe("onStoreDocument", () => {
    it("persists crdtState and materialized markdown", async () => {
      const ydoc = new Y.Doc();
      prisma.document.upsert.mockResolvedValue({});

      await service.handleStoreDocument(ydoc, "doc1", "user1", "notes/test.md");

      expect(prisma.document.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_path: { userId: "user1", path: "notes/test.md" } },
          update: expect.objectContaining({
            crdtState: expect.any(Buffer),
            markdown: expect.any(String),
          }),
          create: expect.objectContaining({
            id: "doc1",
            userId: "user1",
            path: "notes/test.md",
            crdtState: expect.any(Buffer),
            markdown: expect.any(String),
          }),
        }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jason/Desktop/git/slate/apps/core-backend && npx jest collaboration.gateway.spec --no-coverage`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create the collaboration service**

Create `apps/core-backend/src/collaboration/collaboration.service.ts`:

````typescript
import { Injectable, Logger } from "@fastify/common";
import { PrismaService } from "@slate/server-db";
import * as Y from "yjs";

@Injectable()
export class CollaborationService {
  private readonly logger = new Logger(CollaborationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleLoadDocument(doc: Y.Doc, documentId: string, userId: string): Promise<void> {
    const record = await this.prisma.document.findFirst({
      where: { id: documentId, userId },
      select: { crdtState: true },
    });

    if (record?.crdtState) {
      Y.applyUpdate(doc, new Uint8Array(record.crdtState));
    }
  }

  async handleStoreDocument(
    doc: Y.Doc,
    documentId: string,
    userId: string,
    path: string,
  ): Promise<void> {
    const crdtState = Buffer.from(Y.encodeStateAsUpdate(doc));
    const markdown = this.materializeMarkdown(doc);
    const plainText = markdown.replace(/[#*_`~\[\]()>|-]/g, "").trim();
    const title = this.extractTitle(markdown);

    await this.prisma.document.upsert({
      where: { userId_path: { userId, path } },
      update: {
        crdtState,
        markdown,
        plainText,
        title,
      },
      create: {
        id: documentId,
        userId,
        path,
        crdtState,
        markdown,
        plainText,
        title,
      },
    });
  }

  private materializeMarkdown(doc: Y.Doc): string {
    // Use yjs-prosemirror to convert Y.Doc XML fragment to markdown.
    // For now, extract text content from the XML fragment.
    // This will be refined once the TipTap schema is finalized — the
    // tiptap-markdown serializer runs client-side, so server-side we
    // do a simpler extraction from the Y.Doc XML structure.
    const fragment = doc.getXmlFragment("default");
    return this.xmlFragmentToMarkdown(fragment);
  }

  private xmlFragmentToMarkdown(fragment: Y.XmlFragment): string {
    const lines: string[] = [];
    for (let i = 0; i < fragment.length; i++) {
      const child = fragment.get(i);
      if (child instanceof Y.XmlElement) {
        const nodeName = child.nodeName;
        const text = child.toString();
        // Strip XML tags for plain text extraction
        const clean = text.replace(/<[^>]+>/g, "");
        if (nodeName === "heading") {
          const level = child.getAttribute("level") || 1;
          lines.push(`${"#".repeat(Number(level))} ${clean}`);
        } else if (nodeName === "paragraph") {
          lines.push(clean);
        } else if (nodeName === "bulletList" || nodeName === "orderedList") {
          lines.push(clean);
        } else if (nodeName === "codeBlock") {
          lines.push("```\n" + clean + "\n```");
        } else {
          lines.push(clean);
        }
      } else if (child instanceof Y.XmlText) {
        lines.push(child.toString());
      }
    }
    return lines.join("\n\n");
  }

  private extractTitle(markdown: string): string {
    const match = markdown.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : "Untitled";
  }
}
````

- [ ] **Step 4: Create the collaboration gateway**

Create `apps/core-backend/src/collaboration/collaboration.gateway.ts`:

```typescript
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@fastify/common";
import { Server } from "@hocuspocus/server";
import { CollaborationService } from "./collaboration.service";
import { AuthSessionService } from "../auth/auth-session.service";
import { IncomingMessage } from "http";

@Injectable()
export class CollaborationGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CollaborationGateway.name);
  private server: Server;

  constructor(
    private readonly collaborationService: CollaborationService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  onModuleInit() {
    this.server = Server.configure({
      name: "slate-collaboration",
      timeout: 30000,
      debounce: 2000,
      maxDebounce: 10000,

      async onAuthenticate(data) {
        const token = data.token;
        if (!token) {
          throw new Error("No authentication token provided");
        }

        try {
          const session = await this.authSessionService.validateAccessToken(token);
          // Attach userId to connection context for use in other hooks
          return { userId: session.userId };
        } catch {
          throw new Error("Invalid authentication token");
        }
      },

      async onLoadDocument(data) {
        const context = data.context as { userId: string };
        const documentId = data.documentName;
        await this.collaborationService.handleLoadDocument(
          data.document,
          documentId,
          context.userId,
        );
      },

      async onStoreDocument(data) {
        const context = data.context as { userId: string };
        const documentId = data.documentName;
        // The path is stored as a document attribute by the client
        const path = (data.document.getMap("meta").get("path") as string) || documentId;
        await this.collaborationService.handleStoreDocument(
          data.document,
          documentId,
          context.userId,
          path,
        );
      },

      async onConnect(data) {
        this.logger.log(`Client connected: ${data.documentName}`);
      },

      async onDisconnect(data) {
        this.logger.log(`Client disconnected: ${data.documentName}`);
      },
    });

    // Bind `this` context for hooks that reference gateway services
    const gateway = this;
    this.server = Server.configure({
      name: "slate-collaboration",
      timeout: 30000,
      debounce: 2000,
      maxDebounce: 10000,

      async onAuthenticate(data) {
        const token = data.token;
        if (!token) {
          throw new Error("No authentication token provided");
        }
        const session = await gateway.authSessionService.validateAccessToken(token);
        return { userId: session.userId };
      },

      async onLoadDocument(data) {
        const context = data.context as { userId: string };
        await gateway.collaborationService.handleLoadDocument(
          data.document,
          data.documentName,
          context.userId,
        );
      },

      async onStoreDocument(data) {
        const context = data.context as { userId: string };
        const path = (data.document.getMap("meta").get("path") as string) || data.documentName;
        await gateway.collaborationService.handleStoreDocument(
          data.document,
          data.documentName,
          context.userId,
          path,
        );
      },

      async onConnect(data) {
        gateway.logger.log(`Client connected: ${data.documentName}`);
      },

      async onDisconnect(data) {
        gateway.logger.log(`Client disconnected: ${data.documentName}`);
      },
    });

    this.logger.log("Hocuspocus collaboration server configured");
  }

  async onModuleDestroy() {
    if (this.server) {
      await this.server.destroy();
    }
  }

  handleConnection(connection: WebSocket, request: IncomingMessage) {
    this.server.handleConnection(connection, request);
  }

  getServer(): Server {
    return this.server;
  }
}
```

- [ ] **Step 5: Create the collaboration module**

Create `apps/core-backend/src/collaboration/collaboration.module.ts`:

```typescript
import { Module } from "@fastify/common";
import { CollaborationGateway } from "./collaboration.gateway";
import { CollaborationService } from "./collaboration.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  providers: [CollaborationGateway, CollaborationService],
  exports: [CollaborationGateway],
})
export class CollaborationModule {}
```

- [ ] **Step 6: Wire WebSocket upgrade into Fastify**

Modify `apps/core-backend/src/main.ts` to handle WebSocket upgrades on the `/collaboration` path and hand them to Hocuspocus:

```typescript
import { NestFactory } from "@fastify/core";
import { MicroserviceOptions, Transport } from "@fastify/microservices";
import { AppModule } from "./app.module";
import { GrpcLoggingInterceptor } from "./grpc-logging.interceptor";
import { CollaborationGateway } from "./collaboration/collaboration.gateway";

async function bootstrap() {
  const PORT = process.env.PORT;
  const app = await NestFactory.create(AppModule);

  const grpc = app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: "slate.v1",
      protoPath: "../../packages/proto/slate.proto",
      url: "0.0.0.0:50051",
    },
  });
  grpc.useGlobalInterceptors(new GrpcLoggingInterceptor());
  await app.startAllMicroservices();

  const server = await app.listen(PORT || 4000);

  // Wire WebSocket upgrades to Hocuspocus
  const gateway = app.get(CollaborationGateway);
  server.on("upgrade", (request, socket, head) => {
    if (request.url === "/collaboration") {
      gateway.handleConnection(socket as any, request);
    }
  });
}
bootstrap();
```

- [ ] **Step 7: Import CollaborationModule in AppModule**

In `apps/core-backend/src/app.module.ts`, add:

```typescript
import { CollaborationModule } from "./collaboration/collaboration.module";

@Module({
  imports: [
    // ...existing modules...
    CollaborationModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd /Users/jason/Desktop/git/slate/apps/core-backend && npx jest collaboration.gateway.spec --no-coverage`
Expected: All tests PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/core-backend/src/collaboration/ apps/core-backend/src/main.ts apps/core-backend/src/app.module.ts
git commit -m "feat: add Hocuspocus collaboration module with WebSocket gateway"
```

---

## Task 4: Desktop — SyncProvider (HocuspocusProvider + y-indexeddb)

**Files:**

- Create: `apps/desktop/src/lib/sync-provider.tsx`
- Delete: `apps/desktop/src/lib/ydoc-context.tsx`

- [ ] **Step 1: Create the SyncProvider component**

Create `apps/desktop/src/lib/sync-provider.tsx`:

```tsx
import { createContext, useContext, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";

interface SyncContextValue {
  ydoc: Y.Doc | null;
  provider: HocuspocusProvider | null;
  isReady: boolean;
  isSynced: boolean;
  isConnected: boolean;
}

const SyncContext = createContext<SyncContextValue>({
  ydoc: null,
  provider: null,
  isReady: false,
  isSynced: false,
  isConnected: false,
});

export function useSyncContext() {
  return useContext(SyncContext);
}

export function SyncProvider({
  noteId,
  backendUrl,
  getToken,
  children,
}: {
  noteId: string | null;
  backendUrl: string | null;
  getToken: () => Promise<string>;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<SyncContextValue>({
    ydoc: null,
    provider: null,
    isReady: false,
    isSynced: false,
    isConnected: false,
  });

  const providerRef = useRef<HocuspocusProvider | null>(null);
  const indexeddbRef = useRef<IndexeddbPersistence | null>(null);

  useEffect(() => {
    if (!noteId) {
      setState({ ydoc: null, provider: null, isReady: false, isSynced: false, isConnected: false });
      return;
    }

    const ydoc = new Y.Doc();

    // Local offline persistence — loads cached state instantly
    const indexeddb = new IndexeddbPersistence(`slate-${noteId}`, ydoc);
    indexeddbRef.current = indexeddb;

    let provider: HocuspocusProvider | null = null;
    let destroyed = false;

    // Once IndexedDB has loaded, the doc is ready for editing (even offline)
    indexeddb.on("synced", () => {
      if (destroyed) return;
      setState((prev) => ({ ...prev, ydoc, isReady: true }));
    });

    // Connect to Hocuspocus if we have a backend URL
    if (backendUrl) {
      const wsUrl = backendUrl.replace(/^http/, "ws") + "/collaboration";

      provider = new HocuspocusProvider({
        url: wsUrl,
        name: noteId,
        document: ydoc,
        token: getToken,
        connect: true,
        preserveConnection: true,
        onSynced() {
          if (!destroyed) {
            setState((prev) => ({ ...prev, isSynced: true }));
          }
        },
        onConnect() {
          if (!destroyed) {
            setState((prev) => ({ ...prev, isConnected: true }));
          }
        },
        onDisconnect() {
          if (!destroyed) {
            setState((prev) => ({ ...prev, isConnected: false, isSynced: false }));
          }
        },
        onAuthenticationFailed() {
          // Token expired or invalid — could trigger re-auth flow
          if (!destroyed) {
            setState((prev) => ({ ...prev, isConnected: false }));
          }
        },
      });

      providerRef.current = provider;
      setState((prev) => ({ ...prev, provider }));
    }

    // If no backendUrl, doc is ready once IndexedDB loads (pure offline)
    if (!backendUrl) {
      setState((prev) => ({ ...prev, ydoc, isReady: true }));
    }

    // Store the note's path in the Y.Doc meta map so the server knows the file path
    const api = (window as any).slateDesktop;
    if (api?.getNotePath) {
      api.getNotePath(noteId).then((path: string) => {
        if (!destroyed && path) {
          ydoc.getMap("meta").set("path", path);
        }
      });
    }

    return () => {
      destroyed = true;
      provider?.destroy();
      providerRef.current = null;
      indexeddb.destroy();
      indexeddbRef.current = null;
      ydoc.destroy();
      setState({ ydoc: null, provider: null, isReady: false, isSynced: false, isConnected: false });
    };
  }, [noteId, backendUrl]);

  return <SyncContext.Provider value={state}>{children}</SyncContext.Provider>;
}
```

- [ ] **Step 2: Delete the old ydoc-context.tsx**

Delete: `apps/desktop/src/lib/ydoc-context.tsx`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/lib/sync-provider.tsx
git rm apps/desktop/src/lib/ydoc-context.tsx
git commit -m "feat: replace YDocProvider with SyncProvider (HocuspocusProvider + y-indexeddb)"
```

---

## Task 5: Desktop — Novel Editor Component

**Files:**

- Create: `apps/desktop/src/components/NovelEditor.tsx`
- Delete: `apps/desktop/src/components/MilkdownEditor.tsx`
- Modify: `apps/desktop/src/styles.css` — remove Milkdown CSS

- [ ] **Step 1: Create the Novel editor component**

Create `apps/desktop/src/components/NovelEditor.tsx`:

```tsx
import { EditorRoot, EditorContent, type JSONContent } from "novel";
import { useSyncContext } from "../lib/sync-provider";
import Collaboration from "@tiptap/extension-collaboration";
import { useEffect, useState } from "react";

interface NovelEditorProps {
  onContentChange?: (markdown: string) => void;
}

export function NovelEditor({ onContentChange }: NovelEditorProps) {
  const { ydoc, isReady } = useSyncContext();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Novel needs a tick to mount properly in Electron
    setMounted(true);
  }, []);

  if (!isReady || !ydoc || !mounted) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <EditorRoot>
      <EditorContent
        extensions={[
          Collaboration.configure({
            document: ydoc,
          }),
        ]}
        className="slate-editor"
        editorProps={{
          attributes: {
            class: "prose prose-invert max-w-none focus:outline-none",
          },
        }}
        onUpdate={({ editor }) => {
          if (onContentChange && editor) {
            // Novel provides markdown export via the editor storage
            const markdown = editor.storage.markdown?.getMarkdown?.() ?? "";
            onContentChange(markdown);
          }
        }}
      />
    </EditorRoot>
  );
}
```

Note: The exact Novel API may need adjustment based on the installed version. The key contract is: Novel receives a Y.Doc via the Collaboration extension and renders the editor. The `onContentChange` callback provides serialized markdown for file writing.

- [ ] **Step 2: Remove all Milkdown CSS from styles.css**

Read `apps/desktop/src/styles.css` and remove all classes prefixed with `.milkdown`, `.slate-milkdown-editor`, and any Milkdown-specific ProseMirror overrides. Replace with minimal Novel/TipTap prose styling:

```css
/* Add these for the Novel editor */
.slate-editor .ProseMirror {
  padding: 28px 36px 40px;
  max-width: 1200px;
  margin: 0 auto;
  min-height: 68vh;
  outline: none;
}

.slate-editor .ProseMirror p.is-editor-empty:first-child::before {
  content: "Start writing, or press '/' for commands...";
  color: rgba(255, 255, 255, 0.25);
  float: left;
  pointer-events: none;
  height: 0;
}
```

- [ ] **Step 3: Delete MilkdownEditor.tsx**

Delete: `apps/desktop/src/components/MilkdownEditor.tsx`

- [ ] **Step 4: Commit**

```bash
git rm apps/desktop/src/components/MilkdownEditor.tsx
git add apps/desktop/src/components/NovelEditor.tsx apps/desktop/src/styles.css
git commit -m "feat: replace Milkdown editor with Novel (TipTap), remove Milkdown CSS"
```

---

## Task 6: Desktop — Wire SyncProvider + NovelEditor into App.tsx

**Files:**

- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Replace imports**

In `apps/desktop/src/App.tsx`, replace:

```typescript
import { MilkdownEditor, type MilkdownEditorHandle } from "./components/MilkdownEditor";
import { YDocProvider, useYDoc } from "./lib/ydoc-context";
```

With:

```typescript
import { NovelEditor } from "./components/NovelEditor";
import { SyncProvider, useSyncContext } from "./lib/sync-provider";
```

- [ ] **Step 2: Replace YDocProvider with SyncProvider**

Find the `<YDocProvider noteId={...}>` wrapper and replace with:

```tsx
<SyncProvider
  noteId={activeNoteId}
  backendUrl={backendEndpoint || null}
  getToken={async () => {
    const api = (window as any).slateDesktop;
    const snapshot = await api.getSnapshot();
    return snapshot?.backend?.accessToken ?? "";
  }}
>
```

- [ ] **Step 3: Replace MilkdownEditor with NovelEditor**

Find the `<MilkdownEditor ref={editorRef} ... />` usage and replace with:

```tsx
<NovelEditor
  onContentChange={(markdown) => {
    const api = (window as any).slateDesktop;
    api?.saveNote?.({ noteId: activeNoteId, markdown });
  }}
/>
```

Remove the `editorRef` and any `MilkdownEditorHandle` usage — Novel manages its own state via the Y.Doc.

- [ ] **Step 4: Remove useYDoc() calls**

Search for any `useYDoc()` calls in App.tsx and replace with `useSyncContext()` where needed (e.g., for checking `isReady`, `isSynced`, `isConnected` status).

- [ ] **Step 5: Verify the app compiles**

Run: `cd /Users/jason/Desktop/git/slate/apps/desktop && npx vite build`
Expected: Build succeeds with no errors. (Runtime testing comes later.)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat: wire SyncProvider + NovelEditor into App.tsx"
```

---

## Task 7: Desktop — File Watcher for External Edits

**Files:**

- Create: `apps/desktop/electron/services/file-watcher.mjs`
- Create: `apps/desktop/electron/services/file-watcher.test.mjs`

- [ ] **Step 1: Write tests for the file watcher**

Create `apps/desktop/electron/services/file-watcher.test.mjs`:

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileWatcher } from "./file-watcher.mjs";
import { createHash } from "crypto";

function md5(content) {
  return createHash("md5").update(content).digest("hex");
}

describe("FileWatcher", () => {
  let watcher;
  let mockMetadataStore;
  let mockOnExternalChange;

  beforeEach(() => {
    mockMetadataStore = {
      getSetting: vi.fn().mockReturnValue(false), // autoReconcileFilesystem = false
    };
    mockOnExternalChange = vi.fn();
    watcher = new FileWatcher({
      metadataStore: mockMetadataStore,
      onExternalChange: mockOnExternalChange,
    });
  });

  describe("self-write tracking", () => {
    it("ignores file changes that match a self-write hash", () => {
      const content = "# Hello\n\nWorld";
      const hash = md5(content);
      const filePath = "/workspace/notes/test.md";

      watcher.recordSelfWrite(filePath, content);
      const isExternal = watcher.isExternalChange(filePath, content);

      expect(isExternal).toBe(false);
    });

    it("detects external changes when hash differs from self-write", () => {
      const original = "# Hello\n\nWorld";
      const external = "# Hello\n\nModified externally";
      const filePath = "/workspace/notes/test.md";

      watcher.recordSelfWrite(filePath, original);
      const isExternal = watcher.isExternalChange(filePath, external);

      expect(isExternal).toBe(true);
    });

    it("treats unknown files as external changes", () => {
      const isExternal = watcher.isExternalChange("/unknown/file.md", "content");
      expect(isExternal).toBe(true);
    });
  });

  describe("external change handling", () => {
    it("calls onExternalChange when auto-reconcile is off", () => {
      mockMetadataStore.getSetting.mockReturnValue(false);
      const filePath = "/workspace/notes/test.md";
      const content = "# Modified";

      watcher.handleFileChange(filePath, content);

      expect(mockOnExternalChange).toHaveBeenCalledWith({
        filePath,
        content,
        autoReconcile: false,
      });
    });

    it("calls onExternalChange with autoReconcile=true when setting is on", () => {
      mockMetadataStore.getSetting.mockReturnValue(true);
      const filePath = "/workspace/notes/test.md";
      const content = "# Modified";

      watcher.handleFileChange(filePath, content);

      expect(mockOnExternalChange).toHaveBeenCalledWith({
        filePath,
        content,
        autoReconcile: true,
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jason/Desktop/git/slate/apps/desktop && npx vitest run electron/services/file-watcher.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the file watcher**

Create `apps/desktop/electron/services/file-watcher.mjs`:

```javascript
import { watch } from "chokidar";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { join, extname } from "path";

export class FileWatcher {
  constructor({ metadataStore, onExternalChange }) {
    this.metadataStore = metadataStore;
    this.onExternalChange = onExternalChange;
    this.selfWriteHashes = new Map(); // filePath -> md5 hash
    this.watcher = null;
  }

  start(workspaceRoot) {
    if (this.watcher) {
      this.watcher.close();
    }

    this.watcher = watch(join(workspaceRoot, "**/*.md"), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.watcher.on("change", async (filePath) => {
      try {
        const content = await readFile(filePath, "utf-8");
        if (!this.isExternalChange(filePath, content)) {
          return; // Self-write, ignore
        }
        this.handleFileChange(filePath, content);
      } catch (err) {
        // File may have been deleted between event and read
        if (err.code !== "ENOENT") {
          console.error("[FileWatcher] Error reading changed file:", err);
        }
      }
    });
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  recordSelfWrite(filePath, content) {
    this.selfWriteHashes.set(filePath, this.hash(content));
  }

  isExternalChange(filePath, content) {
    const lastHash = this.selfWriteHashes.get(filePath);
    if (!lastHash) return true;
    return this.hash(content) !== lastHash;
  }

  handleFileChange(filePath, content) {
    const autoReconcile = this.metadataStore.getSetting("autoReconcileFilesystem", false);
    this.onExternalChange({ filePath, content, autoReconcile });
  }

  hash(content) {
    return createHash("md5").update(content).digest("hex");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jason/Desktop/git/slate/apps/desktop && npx vitest run electron/services/file-watcher.test.mjs`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/services/file-watcher.mjs apps/desktop/electron/services/file-watcher.test.mjs
git commit -m "feat: add file watcher for external .md edit detection"
```

---

## Task 8: Desktop — Settings Dialog Auto-Reconcile Toggle

**Files:**

- Modify: `apps/desktop/src/components/SettingsDialog.tsx`

- [ ] **Step 1: Add the auto-reconcile toggle to the settings dialog**

In `apps/desktop/src/components/SettingsDialog.tsx`, add a new setting in the "workspace" section. After the workspace root path UI, add:

```tsx
<div className="flex items-center justify-between py-3">
  <div>
    <div className="text-sm font-medium">Auto-load external file changes</div>
    <div className="text-xs text-muted-foreground">
      Automatically load changes when .md files are edited outside Slate
    </div>
  </div>
  <label className="relative inline-flex items-center cursor-pointer">
    <input
      type="checkbox"
      className="sr-only peer"
      checked={autoReconcileFilesystem}
      onChange={(e) => onAutoReconcileChange(e.target.checked)}
    />
    <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
  </label>
</div>
```

- [ ] **Step 2: Add the props and state wiring**

Add to the `SettingsDialogProps` interface:

```typescript
autoReconcileFilesystem: boolean;
onAutoReconcileChange: (value: boolean) => void;
```

In `App.tsx`, load/save this setting via the preload API:

```typescript
const [autoReconcile, setAutoReconcile] = useState(false);

useEffect(() => {
  const api = (window as any).slateDesktop;
  api?.getSetting?.("autoReconcileFilesystem").then((v: boolean) => setAutoReconcile(!!v));
}, []);

const handleAutoReconcileChange = (value: boolean) => {
  setAutoReconcile(value);
  const api = (window as any).slateDesktop;
  api?.setSetting?.("autoReconcileFilesystem", value);
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/SettingsDialog.tsx apps/desktop/src/App.tsx
git commit -m "feat: add auto-reconcile filesystem toggle in settings"
```

---

## Task 9: Desktop — Clean Up main.mjs and preload.mjs

**Files:**

- Modify: `apps/desktop/electron/main.mjs`
- Modify: `apps/desktop/electron/preload.mjs`
- Modify: `apps/desktop/electron/services/metadata-store.mjs`

- [ ] **Step 1: Remove old service imports and instantiation from main.mjs**

In `apps/desktop/electron/main.mjs`, remove:

```javascript
// DELETE these imports:
import { SyncService } from "./services/sync-service.mjs";
import { syncVerbose } from "./services/sync-logger.mjs";
import { YDocManager } from "./services/ydoc-manager.mjs";
import { BackendClient } from "./services/backend-client.mjs";

// DELETE these globals:
let syncService;
let backendClient;
let ydocManager;
```

Remove all `syncService.*`, `backendClient.*`, `ydocManager.*` references throughout the file. Remove the `materializeTimers` map and `scheduleMaterialize`/`cancelMaterialize` functions.

- [ ] **Step 2: Remove sync-related IPC handlers from main.mjs**

Remove these IPC handlers:

```javascript
// DELETE these handlers:
ipcMain.handle("desktop:getCrdtState", ...)
ipcMain.handle("desktop:setActiveNoteId", ...)
ipcMain.handle("desktop:applyCrdtUpdate", ...)
ipcMain.handle("desktop:syncNow", ...)
ipcMain.handle("desktop:fullSync", ...)
ipcMain.handle("desktop:setBackendEndpoint", ...)
ipcMain.handle("desktop:checkBackendConnection", ...)
ipcMain.handle("desktop:refreshBackendStatus", ...)
ipcMain.handle("desktop:connectBackend", ...)
```

Keep the auth-related IPC handlers (`loginWithPassword`, `loginWithOidc`, `signOutBackend`) but rewire them to talk directly to the backend HTTP API instead of going through `syncService`/`backendClient`.

- [ ] **Step 3: Add file watcher wiring to main.mjs**

Add the FileWatcher instantiation and IPC for external edit prompts:

```javascript
import { FileWatcher } from "./services/file-watcher.mjs";

let fileWatcher;

// In the app initialization:
fileWatcher = new FileWatcher({
  metadataStore,
  onExternalChange: ({ filePath, content, autoReconcile }) => {
    if (autoReconcile) {
      // Send to renderer to apply to Y.Doc directly
      mainWindow?.webContents.send("desktop:externalFileChange", {
        filePath,
        content,
        action: "load",
      });
    } else {
      // Prompt user
      mainWindow?.webContents.send("desktop:externalFileChange", {
        filePath,
        content,
        action: "prompt",
      });
    }
  },
});
fileWatcher.start(workspaceRoot);
```

Add IPC for the user's prompt response:

```javascript
ipcMain.handle("desktop:resolveExternalChange", async (_event, { filePath, action }) => {
  if (action === "overwrite") {
    // Renderer will re-materialize and overwrite the file — file watcher ignores self-writes
    return { action: "overwrite" };
  }
  // action === "load" is handled by the renderer applying the content to Y.Doc
  return { action: "load" };
});
```

- [ ] **Step 4: Add saveNote IPC for markdown-to-disk writes**

The `saveNote` handler should now just write markdown to disk and record the self-write hash:

```javascript
ipcMain.handle("desktop:saveNote", async (_event, { noteId, markdown }) => {
  const note = metadataStore.getNoteById(noteId);
  if (!note) return;
  const absolutePath = join(workspaceRoot, note.relative_path);
  await writeFile(absolutePath, markdown, "utf-8");
  fileWatcher.recordSelfWrite(absolutePath, markdown);
});
```

- [ ] **Step 5: Clean up preload.mjs**

In `apps/desktop/electron/preload.mjs`, remove the old CRDT IPC methods:

```javascript
// DELETE these:
getCrdtState: ...
setActiveNoteId: ...
applyCrdtUpdate: ...
onRemoteCrdtUpdate: ...
offRemoteCrdtUpdate: ...
onCrdtStateReset: ...
offCrdtStateReset: ...
syncNow: ...
fullSync: ...
connectBackend: ...
```

Add new IPC methods:

```javascript
// ADD these:
getNotePath: (noteId) => ipcRenderer.invoke("desktop:getNotePath", noteId),
getSetting: (key) => ipcRenderer.invoke("desktop:getSetting", key),
setSetting: (key, value) => ipcRenderer.invoke("desktop:setSetting", key, value),
onExternalFileChange: (callback) =>
  ipcRenderer.on("desktop:externalFileChange", (_event, payload) => callback(payload)),
offExternalFileChange: () =>
  ipcRenderer.removeAllListeners("desktop:externalFileChange"),
resolveExternalChange: (payload) =>
  ipcRenderer.invoke("desktop:resolveExternalChange", payload),
```

- [ ] **Step 6: Slim down metadata-store.mjs**

In `apps/desktop/electron/services/metadata-store.mjs`, in the `migrate()` method, remove the `notes` table creation (or leave it empty but stop writing to CRDT columns). The simplest approach: drop the notes table entirely and only keep `settings`, `pending_attachments`, and `keyboard_shortcuts`.

Remove these methods:

- `upsertNote`, `getNoteById`, `getNoteByPath`, `listNotes`, `listDirtyNotes`, `listDeletedDirtyNotes`
- `markDirty`, `markDeleted`, `getCrdtState`, `setCrdtState`, `getStateVector`, `setStateVector`
- `updateNoteRevision`, `setPinned`

Keep:

- `getSetting`, `setSetting`
- `listPendingAttachments`, `addPendingAttachment`, `removePendingAttachment`
- `getKeyboardShortcuts`, `setKeyboardShortcut`
- Calendar reminder methods

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/electron/main.mjs apps/desktop/electron/preload.mjs apps/desktop/electron/services/metadata-store.mjs
git commit -m "refactor: clean up main.mjs, preload.mjs, and metadata-store for Hocuspocus sync"
```

---

## Task 10: Delete Old Sync Files

**Files:**

- Delete: `apps/desktop/electron/services/sync-service.mjs`
- Delete: `apps/desktop/electron/services/sync-service.test.mjs`
- Delete: `apps/desktop/electron/services/ydoc-manager.mjs`
- Delete: `apps/desktop/electron/services/backend-client.mjs`
- Delete: `apps/desktop/electron/services/sync-logger.mjs`
- Delete: `apps/desktop/electron/services/sync-intervals.mjs`
- Delete: `apps/desktop/electron/services/disk-content-hash.mjs`
- Delete: `apps/desktop/electron/services/workspace-disk-reconcile.mjs`
- Delete: `apps/core-backend/src/documents/crdt.service.ts`
- Delete: `apps/core-backend/src/documents/documents.controller.ts`

- [ ] **Step 1: Delete desktop sync files**

```bash
cd /Users/jason/Desktop/git/slate
git rm apps/desktop/electron/services/sync-service.mjs
git rm apps/desktop/electron/services/sync-service.test.mjs
git rm apps/desktop/electron/services/ydoc-manager.mjs
git rm apps/desktop/electron/services/backend-client.mjs
git rm apps/desktop/electron/services/sync-logger.mjs
git rm apps/desktop/electron/services/sync-intervals.mjs
git rm apps/desktop/electron/services/disk-content-hash.mjs
git rm apps/desktop/electron/services/workspace-disk-reconcile.mjs
```

- [ ] **Step 2: Delete backend sync files**

```bash
git rm apps/core-backend/src/documents/crdt.service.ts
git rm apps/core-backend/src/documents/documents.controller.ts
```

- [ ] **Step 3: Update documents.module.ts**

In `apps/core-backend/src/documents/documents.module.ts`, remove references to deleted files:

```typescript
// REMOVE from providers:
(CrdtService, DocumentsController);

// Keep DocumentsService if it still handles non-sync document operations
// (search, listing, etc.) — otherwise delete the entire module
```

- [ ] **Step 4: Verify build succeeds**

Run: `cd /Users/jason/Desktop/git/slate/apps/core-backend && npx nest build`
Expected: Build succeeds with no missing import errors.

Run: `cd /Users/jason/Desktop/git/slate/apps/desktop && npx vite build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete old sync-service, ydoc-manager, backend-client, crdt.service, documents.controller"
```

---

## Task 11: Integration — End-to-End Smoke Test

**Files:**

- No new files — manual verification

- [ ] **Step 1: Start the backend**

Run: `cd /Users/jason/Desktop/git/slate/apps/core-backend && npm run start:dev`
Expected: Fastify starts, logs "Hocuspocus collaboration server configured", listens on port 4000.

- [ ] **Step 2: Verify WebSocket endpoint**

Run: `wscat -c ws://localhost:4000/collaboration` (or test with a simple script)
Expected: Connection established (will fail auth, but the upgrade should succeed).

- [ ] **Step 3: Start the desktop app**

Run: `cd /Users/jason/Desktop/git/slate/apps/desktop && npm run dev`
Expected: Electron opens, Novel editor renders, no console errors about missing Milkdown modules.

- [ ] **Step 4: Create a note and verify sync**

1. Create a new note in the app
2. Type some content
3. Check that a `.md` file appears in the workspace directory with the typed content
4. Check the Postgres `Document` table — should contain a row with `crdtState` and `markdown`

- [ ] **Step 5: Test offline editing**

1. Stop the backend server
2. Edit the note in the app — should work with no errors
3. Restart the backend
4. Verify the edits sync to the server (check Postgres)

- [ ] **Step 6: Test external file edit**

1. Open a note's `.md` file in an external editor (e.g., VS Code)
2. Make a change and save
3. Verify a prompt appears in Slate asking to load or overwrite
4. Click "Load" and verify the editor updates
5. Repeat with auto-reconcile ON in settings — verify it loads automatically

- [ ] **Step 7: Commit any fixes discovered during testing**

```bash
git add -A
git commit -m "fix: integration fixes from end-to-end smoke testing"
```
