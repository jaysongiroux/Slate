# RxDB Migration Design

Replace all client-side storage and sync (SQLite, Yjs, Hocuspocus, y-indexeddb, custom sync) with RxDB. Server-side Yjs/Hocuspocus removed. Replication via HTTP pull/push + SSE stream.

## Decisions

| Decision              | Choice                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Storage format        | ProseMirror JSON in RxDB (`content`), markdown materialized server-side for embedding/search |
| `plainText` column    | Dropped. Search indexes against `markdown` instead                                           |
| Materialization       | Server-side, in a pg-boss worker after push                                                  |
| Replication transport | HTTP pull/push + SSE pull stream (no WebSocket)                                              |
| RxDB storage adapter  | Free IndexedDB adapter (`rxdb/plugins/storage-dexie`)                                        |
| Conflict resolution   | Latest `updatedAt` wins; edits always win over deletes                                       |
| RxDB location         | Renderer process (not main)                                                                  |
| IPC surface           | Shrinks to: config read/write, attachments, window management                                |
| Pending attachments   | Main process JSON file queue (not RxDB)                                                      |
| Migration             | None needed. Pre-deployment app, fresh schemas.                                              |
| Approach              | Big bang. Replace all storage/sync in one pass.                                              |

---

## RxDB Collections (Client-Side, Renderer)

### `notes`

```typescript
{
  id: string,           // cuid
  title: string,
  path: string,         // unique relative path (e.g. "journal/2026-04-10")
  content: object,      // ProseMirror JSON
  pinned: boolean,
  deleted: boolean,     // soft delete
  isTemplate: boolean,
  updatedAt: string,    // ISO timestamp
  createdAt: string
}
```

### `folders`

```typescript
{
  id: string,
  path: string,         // unique folder path
  createdAt: string,
  updatedAt: string
}
```

### `settings`

```typescript
{
  id: string,           // setting key (e.g. "keyboardShortcuts", "sidebarWidth")
  value: any,           // JSON value
  updatedAt: string
}
```

### Not in RxDB

Auth tokens (JWT, refresh), backend URL, and token expiry stay in `config.json` in Electron's `userData` directory, managed by the main process.

---

## Replication Architecture

### Transport

- **Pull:** HTTP POST, checkpoint-based batch fetch
- **Push:** HTTP POST, sends writes with `assumedMasterState` for conflict detection
- **Stream:** SSE (Server-Sent Events), server pushes change events in real-time

Each collection replicates independently to its own endpoint group.

### Server Endpoints (Fastify)

```
POST /api/replication/notes/pull
POST /api/replication/notes/push
GET  /api/replication/notes/stream

POST /api/replication/folders/pull
POST /api/replication/folders/push
GET  /api/replication/folders/stream

POST /api/replication/settings/pull
POST /api/replication/settings/push
GET  /api/replication/settings/stream
```

All endpoints require JWT authentication via existing auth middleware.

### Checkpoint

Checkpoint is `{ updatedAt: string, id: string }`. The pair ensures deterministic pagination even with identical timestamps.

Pull query pattern:

```sql
SELECT * FROM "Document"
WHERE "userId" = $1
  AND ("updatedAt" > $checkpointUpdatedAt
       OR ("updatedAt" = $checkpointUpdatedAt AND "id" > $checkpointId))
ORDER BY "updatedAt", "id"
LIMIT $batchSize
```

### SSE Event Bus

In-memory `EventEmitter` on the server. When a push handler writes to PostgreSQL, it publishes to the event bus. SSE stream handlers subscribe and forward events to connected clients. This enables multi-device sync: device A pushes, server writes, event bus fires, device B's SSE stream receives the change.

### Conflict Resolution

- Compare `assumedMasterState` against current DB row
- If they match: write succeeds
- If they differ: return the conflict to the client
- Client-side resolution: latest `updatedAt` wins, except edits always win over deletes (a deleted note that was edited on another device reappears)

---

## Server-Side Changes

### Removed

| Component             | File                                         | Lines | Reason                         |
| --------------------- | -------------------------------------------- | ----- | ------------------------------ |
| Hocuspocus plugin     | `src/plugins/collaboration.ts`               | 106   | WebSocket CRDT relay gone      |
| Collaboration service | `src/collaboration/collaboration.service.ts` | 89    | Hocuspocus callbacks gone      |
| CRDT service          | `src/documents/crdt.service.ts`              | 172   | Yjs merge/bootstrap/delta gone |
| DeviceCursor model    | Prisma schema                                | —     | RxDB manages checkpoints       |

### Added

```
apps/core-backend/src/
  replication/
    replication.plugin.ts       # Fastify plugin, registers all routes
    notes.replication.ts        # Pull/push/stream for notes
    folders.replication.ts      # Pull/push/stream for folders
    settings.replication.ts     # Pull/push/stream for settings
    sse-event-bus.ts            # In-memory EventEmitter for change notifications
    conflict.ts                 # Conflict detection logic
  materialization/
    materialize.service.ts      # ProseMirror JSON -> markdown
    materialize.worker.ts       # pg-boss job handler
```

### Prisma Schema Changes

```prisma
model Document {
  id          String          @id @default(cuid())
  userId      String
  title       String
  path        String
  content     Json            // ProseMirror JSON (NEW, replaces crdtState)
  markdown    String          @db.Text
  deleted     Boolean         @default(false)
  pinned      Boolean         @default(false)
  isTemplate  Boolean         @default(false)
  embedded    Boolean         @default(false)
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  attachments Attachment[]
  chunks      DocumentChunk[]
  user        User            @relation(fields: [userId], references: [id])

  @@unique([userId, path])
  @@index([userId, updatedAt])
}

model Folder {
  id        String   @id @default(cuid())
  userId    String
  path      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id])

  @@unique([userId, path])
  @@index([userId, updatedAt])
}

model Setting {
  id        String   @id
  userId    String
  value     Json
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id])

  @@unique([userId, id])
  @@index([userId, updatedAt])
}
```

**Dropped from Document:** `crdtState`, `plainText`, `serverSeq`
**Dropped model:** `DeviceCursor`

### Materialization Pipeline

On push, after writing the note to PostgreSQL:

1. Push handler writes `content` (JSON) and `updatedAt`
2. Publishes to SSE event bus (immediate, for other devices)
3. Enqueues pg-boss job `materialize`
4. Job reads `content` JSON from the document
5. ProseMirror JSON -> markdown via shared schema (`@slate/shared`)
6. Updates `markdown` column
7. If content changed, enqueues `search-index` job for re-embedding

### Search Service Change

Replace `plainText` with `markdown` in `search.service.ts`:

```sql
to_tsvector('english', coalesce(title, '') || ' ' || coalesce("markdown", ''))
```

### AdminJS Resource Update

In `adminjs-resources.ts`:

- Remove `plainText` display references
- Remove `crdtState` filter (column is gone)
- Optionally add `content` (JSON) as read-only view

---

## Client-Side Changes

### Removed

| Component               | File                              | Lines | Replaced by                    |
| ----------------------- | --------------------------------- | ----- | ------------------------------ |
| SQLite metadata store   | `metadata-store.mjs`              | 473   | RxDB collections + config.json |
| Note store              | `note-store.mjs`                  | 326   | RxDB `notes` collection        |
| Sync provider           | `sync-provider.tsx`               | 206   | RxDB reactive subscriptions    |
| Collaboration extension | `@tiptap/extension-collaboration` | —     | Tiptap `onUpdate` -> RxDB      |

### New Client-Side Structure

```
apps/desktop/src/
  db/
    database.ts             # RxDB instance creation + collections
    schemas/
      note.schema.ts        # Notes collection schema
      folder.schema.ts      # Folders collection schema
      setting.schema.ts     # Settings collection schema
    replication.ts          # Pull/push/SSE stream setup per collection
    conflict-handler.ts     # updatedAt wins, edit > delete
  hooks/
    use-notes.ts            # RxDB reactive queries
    use-folders.ts
    use-settings.ts
```

### Editor Save Flow

```
Tiptap onUpdate (debounced ~500ms)
  -> editor.getJSON()
  -> rxdb.notes.upsert({ id, content: json, title, updatedAt })
  -> RxDB replication pushes to server automatically
```

### Main Process (Slimmed Down)

```
apps/desktop/electron/
  main.mjs                  # Window management, reduced IPC handlers
  services/
    config-store.mjs        # JSON file: auth tokens, backend URL, token expiry
    pending-uploads.mjs     # Attachment retry queue (JSON file)
  preload.mjs               # Exposes: config, attachments, window management
```

IPC surface shrinks from ~50+ methods to:

- `getConfig` / `setConfig` (auth tokens, backend URL)
- `uploadAttachment` / `resolveAttachmentUrl`
- `listPendingUploads` / `retryPendingUploads`
- Window management (minimize, maximize, close)

---

## Dependency Changes

### Removed from desktop app

- `yjs`, `y-indexeddb`, `y-prosemirror`, `y-protocols`
- `@hocuspocus/provider`
- `@tiptap/extension-collaboration`
- `node:sqlite` / `better-sqlite3`

### Removed from core backend

- `@hocuspocus/server`, `@hocuspocus/extension-database`
- `yjs`, `y-prosemirror`, `y-protocols`

### Added to desktop app

- `rxdb` (includes `rxdb/plugins/storage-dexie`)

### Added to core backend

- None

### Shared package cleanup

Remove: `tiptap-ydoc.ts`, `y-doc-content.ts`
Keep: `schema.ts`, `markdown-serializer.ts`, `markdown-parser.ts`, `prosemirror-normalize.ts`

Net: ~12 packages removed, 1 added.

---

## Unchanged Systems

| System                               | Why unchanged                                                |
| ------------------------------------ | ------------------------------------------------------------ |
| Auth (password, TOTP, OIDC)          | Server-side, no storage layer dependency                     |
| AI chat / conversations              | Server-side LLM calls, REST API only                         |
| Calendar                             | Server-side provider integration, REST API only              |
| Attachment routes + storage backends | REST upload/download, filesystem/S3 unaffected               |
| Attachment processing (HEIC -> WebP) | Server-side pipeline, unaffected                             |
| Attachment GC job                    | pg-boss job, queries against `markdown` for orphan detection |
| pg-boss                              | Keeps all existing jobs, gains `materialize` job             |
| Embedding pipeline                   | Already uses `markdown` for chunking                         |
| Admin routes (`/internal/admin/*`)   | Server-side user/OIDC/storage/calendar management            |
| Zustand stores                       | Ephemeral UI state (sidebar mode, dialogs, etc.)             |
| Tiptap extensions                    | All stay except `@tiptap/extension-collaboration`            |
