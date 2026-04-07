# Sync Redesign: Hocuspocus + Novel + Offline-First

**Date:** 2026-04-06
**Status:** Draft
**Scope:** Replace custom push/pull sync with Hocuspocus, replace Milkdown with Novel, keep markdown files on filesystem as output projection.

---

## 1. Goals

- **Simple, robust sync** between one user's multiple devices via Hocuspocus (Yjs WebSocket server)
- **Offline-first** note-taking via y-indexeddb — edits work with zero connectivity, sync on reconnect
- **Markdown files on filesystem** as a readable projection of every note, written on each save
- **External edit support** — file watcher detects out-of-band changes to `.md` files, prompts or auto-loads
- **Editor upgrade** — replace Milkdown with Novel (TipTap-based Notion-style editor)
- **Massive simplification** — delete ~36KB of custom sync logic, remove gRPC document transport, remove per-document SQLite state

## 2. Architecture

```
+-----------------------------------------------------+
|  Desktop (Electron)                                  |
|                                                      |
|  +---------------+   Y.Doc   +--------------------+  |
|  | Novel Editor  |<--------->| HocuspocusProvider |  |
|  | (Renderer)    |           | + y-indexeddb       |  |
|  +---------------+           +---------+----------+  |
|                                        | WebSocket   |
|  +------------------------+            |             |
|  | File Watcher           |            |             |
|  | (Main Process)         |            |             |
|  | - chokidar on vault    |            |             |
|  | - hash comparison      |            |             |
|  | - prompt or auto-load  |            |             |
|  +--------+---------------+            |             |
|           | writes .md                 |             |
|           v                            |             |
|  +---------------+                     |             |
|  | .md files     |                     |             |
|  | (filesystem)  |                     |             |
|  +---------------+                     |             |
+----------------------------------------+-------------+
                                         |
                         +---------------v--------------+
                         |  Core Backend (NestJS)        |
                         |                               |
                         |  +-------------------------+  |
                         |  | Hocuspocus Server        |  |
                         |  | (WebSocket on port 4000) |  |
                         |  |                          |  |
                         |  | onAuthenticate: JWT      |  |
                         |  | onLoadDocument:          |  |
                         |  |   load crdtState from DB |  |
                         |  | onStoreDocument:         |  |
                         |  |   persist crdtState + md |  |
                         |  +-------------------------+  |
                         |                               |
                         |  +-------------------------+  |
                         |  | PostgreSQL               |  |
                         |  | - crdtState (bytes)      |  |
                         |  | - markdown (text)        |  |
                         |  +-------------------------+  |
                         +-------------------------------+
```

## 3. Components

### 3.1 Editor: Novel (TipTap)

Replace `MilkdownEditor.tsx` with a Novel-based editor component.

**Novel provides out of the box:**

- Slash commands, task lists, image handling, code blocks, drag handles
- Markdown serialization via `tiptap-markdown`
- TipTap Collaboration extension for Y.Doc binding

**The editor component receives a Y.Doc** (created by HocuspocusProvider) and binds to it via `@tiptap/extension-collaboration`. No manual onChange -> serialize -> push cycle.

**Custom TipTap extensions needed:**

- Mermaid diagram rendering
- Image upload to storage backend
- Link handling / preview
- Any custom slash commands beyond Novel's defaults

**Deleted:**

- `MilkdownEditor.tsx`
- All `@milkdown/*` packages
- All Milkdown CSS from `styles.css` and component-level styles
- Manual `ySyncPlugin` / `yUndoPlugin` / `yCursorPlugin` wiring

### 3.2 Sync: HocuspocusProvider (Client)

Runs in the Electron renderer process.

```
HocuspocusProvider:
  url: ws://backend-host:4000/collaboration
  name: documentId
  document: ydoc (Y.Doc instance)
  token: () => getAuthToken()  // JWT from SQLite settings store

IndexeddbPersistence:
  name: documentId
  doc: ydoc
```

**Behavior:**

- Online: provider syncs via WebSocket to Hocuspocus server
- Offline: edits persist to IndexedDB automatically, sync on reconnect
- IndexedDB loads cached Y.Doc instantly on app launch (no loading state for offline docs)
- Provider emits `synced`, `disconnect`, `connect` events for UI status indicators

### 3.3 Sync: Hocuspocus Server (Backend)

Embedded in the existing NestJS backend as a WebSocket gateway on port 4000.

**Hooks:**

- **`onAuthenticate(data)`** — validate JWT from `data.token`, extract userId, reject unauthorized connections. Scope document access: a user can only connect to their own documents.
- **`onLoadDocument(data)`** — fetch `crdtState` from Postgres by documentId + userId. If found, apply binary state to `data.document`. If not found (new document), return empty Y.Doc.
- **`onStoreDocument(data)`** — debounced (default 2-5s). Encode Y.Doc to binary `crdtState`. Materialize Y.Doc to markdown string. Upsert to Postgres: `crdtState`, `markdown`, `plainText`, `title` (extracted from first H1).
- **`onConnect` / `onDisconnect`** — logging only.

### 3.4 File Watcher (Desktop Main Process)

Monitors the vault directory for external `.md` file changes.

**Flow:**

1. **On Y.Doc update** (from editor or Hocuspocus sync):
   - Materialize markdown via tiptap-markdown serializer
   - Write `.md` file to disk
   - Store content hash in memory (Map<filePath, hash>)

2. **Chokidar watches vault directory** for `change` events on `*.md` files:
   - Compute hash of changed file
   - Compare to last-known hash
   - If hashes match: self-write, ignore
   - If hashes differ: external edit detected

3. **On external edit detected:**
   - If `autoReconcileFilesystem` setting is ON: read file, convert markdown to ProseMirror JSON via tiptap-markdown's parser, then replace the Y.Doc's XML fragment content with the parsed result (auto-syncs to server via provider)
   - If setting is OFF: send IPC to renderer -> show prompt: _"[filename] was modified outside Slate. Load changes from disk?"_
     - **Yes**: same as auto-reconcile — read file, parse markdown to ProseMirror JSON, replace Y.Doc fragment
     - **No**: overwrite file with current Y.Doc markdown

4. **Ignore self-writes:** tracked via content hash comparison. When we write a file, we store its hash. When chokidar fires, if the new hash matches what we just wrote, it's our own write.

### 3.5 Settings Dialog Addition

New toggle under settings:

- **"Automatically load external file changes"** (default: off)
- Stored in SQLite settings table as `autoReconcileFilesystem` (boolean)
- When on, the file watcher skips the user prompt and auto-loads disk changes

### 3.6 SQLite (Slimmed Down)

SQLite remains but only stores:

- User settings / preferences (theme, vault path, auto-reconcile toggle, sidebar state, etc.)
- Auth tokens (access/refresh)
- App-level metadata (window position, etc.)

**Deleted from SQLite:**

- `crdt_state` / `state_vector` columns (replaced by y-indexeddb)
- `dirty` flag (Hocuspocus tracks sync state)
- `server_seq` bookmarks (no more polling)
- `disk_content_hash` / `disk_mtime_ms` (hashes held in-memory, rebuilt on launch)
- Per-document rows entirely — SQLite has no document table anymore

## 4. Postgres Schema Changes

**Document table** (simplified, same table):

- `id` — CUID, primary key
- `userId` — foreign key
- `title` — extracted from first H1
- `path` — file path, unique per user
- `markdown` — full markdown text (for search, API consumers)
- `plainText` — extracted text (for search)
- `crdtState` — binary Y.Doc state (Bytes)
- `deleted` — soft delete flag
- `pinned` — user pin flag
- `createdAt` / `updatedAt`

**Removed:**

- `serverSeq` (BigInt) — no more sequence-based polling
- `embedded` column — if unused
- `DeviceCursor` table — no more per-device bookmarks

## 5. Full Deletion List

### Desktop — Electron services

- `sync-service.mjs` (~36KB) — entire file
- `sync-service.test.mjs` — entire file
- `ydoc-manager.mjs` — entire file
- `backend-client.mjs` (gRPC client) — entire file
- All sync-related IPC handlers in `main.mjs`
- gRPC deps: `@grpc/grpc-js`, `@grpc/proto-loader` (if only used for doc sync)

### Desktop — Renderer

- `MilkdownEditor.tsx` — entire file
- All `@milkdown/*` packages
- All Milkdown CSS from `styles.css` and component styles
- Manual y-prosemirror plugin wiring code

### Backend

- `PushDocumentUpdate` / `PullDocumentEvents` / `GetDocumentSnapshot` gRPC methods
- `DeviceCursor` Prisma model + table
- Delta computation / state vector logic in `crdt.service.ts`
- Bulk of `documents.service.ts` sync logic
- gRPC document service proto definitions (if no other consumers)

### Shared

- `remapTypeNames()` on both desktop and backend — TipTap uses standard ProseMirror node names

## 6. New Dependencies

### Desktop (apps/desktop)

- `novel` — Novel editor component
- `@hocuspocus/provider` — WebSocket sync client
- `y-indexeddb` — offline persistence
- `@tiptap/extension-collaboration` — Y.Doc binding for TipTap
- `tiptap-markdown` — markdown serialization (if not bundled with Novel)
- `chokidar` — file system watcher (may already be installed)

### Backend (apps/core-backend)

- `@hocuspocus/server` — Hocuspocus server
- `@hocuspocus/extension-database` — custom DB persistence hooks

## 7. Error Handling

- **WebSocket disconnect:** HocuspocusProvider retries with exponential backoff (built-in). UI shows "offline" indicator. Edits continue locally via IndexedDB.
- **IndexedDB failure:** Graceful degradation — edits still work in memory, just won't persist across app restarts while offline. Log warning.
- **Server crash during onStoreDocument:** Hocuspocus retries on next debounce cycle. Document state lives in connected clients and IndexedDB; no data loss.
- **File watcher race:** Content hash comparison prevents reacting to self-writes. If two external edits arrive rapidly, only the final state is prompted/loaded.
- **Auth token expiry:** Provider's `token` option accepts an async function — refresh token before returning. On auth failure, Hocuspocus emits `authenticationFailed` event -> prompt re-login.

## 8. Testing Strategy

- **Unit tests:** Hocuspocus server hooks (onLoadDocument, onStoreDocument, onAuthenticate) — mock Prisma, verify correct Y.Doc encoding/decoding
- **Integration tests:** Start Hocuspocus server, connect two providers, verify document convergence
- **File watcher tests:** Mock chokidar events, verify hash comparison logic, verify prompt IPC messages
- **Offline tests:** Connect provider, disconnect WebSocket, make edits, reconnect, verify sync
- **Editor tests:** Novel renders, binds to Y.Doc, slash commands work
