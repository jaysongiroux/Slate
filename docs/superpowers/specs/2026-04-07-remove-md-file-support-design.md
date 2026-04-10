# Remove Markdown File Support — Design Spec

**Date:** 2026-04-07
**Status:** Approved

## Overview

Remove all markdown filesystem read/write from the Slate desktop app. Notes become database-first: content lives in Y.Docs (IndexedDB offline, Postgres online via Hocuspocus), metadata lives in SQLite. gRPC is removed entirely in favor of REST + SSE. A repeatable folder import feature allows users to bring in existing .md files.

---

## Section 1: Data Architecture

**SQLite `notes` table (simplified):**

```
id            TEXT PRIMARY KEY   -- cuid
path          TEXT UNIQUE        -- virtual path, e.g. "projects/design-doc"
title         TEXT               -- extracted from content
plain_text    TEXT               -- for offline full-text search
pinned        INTEGER            -- 0/1
is_template   INTEGER            -- 0/1
deleted       INTEGER            -- 0/1, pending sync
created_at    TEXT               -- ISO timestamp
updated_at    TEXT               -- ISO timestamp
```

No markdown column, no CRDT state, no disk hashes, no server_seq, no state_vector, no sync_state. Just enough for the sidebar tree, offline organization, and offline full-text search.

The `plain_text` column is updated by the renderer whenever the Y.Doc changes (debounced). The renderer already computes markdown on update; extracting plain text and sending it via IPC is trivial.

**IndexedDB** (unchanged from current): `y-indexeddb` stores a Y.Doc per note keyed by `slate-${noteId}`. This is the offline content cache.

**Postgres** (unchanged): Full note data — crdtState, markdown, plainText, title, path, pinned, deleted, timestamps. Hocuspocus handles the CRDT sync; a lightweight REST sync handles metadata changes.

**Registry sync**: When online, local metadata changes (create, delete, move, rename, pin) push to the backend via REST. On reconnect, a reconciliation step merges any offline changes. Conflict strategy: last-write-wins on metadata fields, CRDT merge on content (handled by Hocuspocus automatically).

---

## Section 2: Files to Delete

**Entire files removed:**

- `apps/desktop/electron/services/workspace-service.mjs` — filesystem note storage
- `apps/desktop/electron/services/sync-service.mjs` — gRPC push/pull sync
- `apps/desktop/electron/services/sync-service.test.mjs`
- `apps/desktop/electron/services/ydoc-manager.mjs` — CRDT management for old sync
- `apps/desktop/electron/services/backend-client.mjs` — gRPC client
- `apps/desktop/electron/services/workspace-disk-reconcile.mjs` — disk hash reconciliation
- `apps/desktop/electron/services/note-crdt-state.mjs` — CRDT state helpers
- `apps/desktop/electron/services/sync-logger.mjs` — sync logging
- `apps/desktop/electron/services/file-watcher.mjs` — chokidar watcher
- `apps/desktop/electron/services/file-watcher.test.mjs`
- `apps/desktop/electron/services/disk-content-hash.mjs` — file hash utilities

**Dependencies to remove from package.json:**

- `chokidar`
- `fast-glob`
- `@grpc/grpc-js`
- `@grpc/proto-loader`
- Any proto file references

**Backend:**

- Remove gRPC microservice from `main.ts` (the `connectMicroservice` + `Transport.GRPC` block)
- Remove `packages/proto/` (or leave if other packages reference it)
- Remove `GrpcLoggingInterceptor`
- Remove gRPC document sync service (documents.controller.ts handles gRPC calls)

---

## Section 3: New Files and Services

### Desktop (main process)

- **`http-client.mjs`** — Replaces backend-client.mjs. Pure fetch-based REST client. Handles:
  - Auth: login, OIDC, refresh token, list providers
  - AI Chat: config, conversations, messages (SSE streaming instead of gRPC streaming)
  - Calendar: all calendar operations
  - Attachments: upload, URL resolution
  - Notes: registry sync (push local metadata changes, pull remote state)
  - Token management: auto-attaches Bearer token, handles 401 → refresh flow

- **`note-store.mjs`** — Replaces workspace-service.mjs for note registry. Thin SQLite wrapper:
  - `createNote(parentPath)` → inserts row, returns id+path
  - `listNotes()` → all non-deleted notes from SQLite
  - `listFolders()` → derive from distinct path prefixes
  - `deleteNote(id)` → marks deleted
  - `moveNote(id, targetPath)` → updates path
  - `renameNote(id, title)` → updates title + path
  - `pinNote(id, pinned)` → updates pinned
  - `createFolder(parentPath)` → no-op in DB (folders are implicit from paths), but we may want an explicit folders table for empty folders
  - Templates: `listTemplates()`, `createTemplate()`, `getTemplate(id)` — just notes with `is_template=1`

- **`import-service.mjs`** — Handles folder import:
  - Recursively finds all .md files in chosen directory
  - For each file: reads content, creates note in SQLite, bootstraps Y.Doc with parsed content, stores in IndexedDB via main-process Y.Doc
  - Maps directory structure to virtual paths
  - Files in a `templates/` subfolder get `is_template=1`
  - Handles duplicate paths (appends suffix)

### Backend (new REST controllers)

- **AI Chat controller** — REST endpoints mirroring the current gRPC AiService: `GET/POST /api/ai/config`, `POST /api/ai/conversations`, `GET /api/ai/conversations/:id/messages`, `POST /api/ai/conversations/:id/messages` (SSE for streaming), `DELETE /api/ai/conversations/:id`, `POST /api/ai/embed`
- **Calendar controller** — REST endpoints mirroring gRPC CalendarService: status, OAuth, subscribe/unsubscribe, events CRUD, RSVP
- **Notes metadata controller** — REST endpoints for registry sync: `GET /api/notes` (list), `POST /api/notes` (create), `PATCH /api/notes/:id` (update path/title/pinned), `DELETE /api/notes/:id`

---

## Section 4: Migration of main.mjs

The main process (main.mjs) currently initializes workspace-service, sync-service, backend-client, and ydoc-manager, and registers ~60+ IPC handlers. Here's how it changes:

**Initialization (simplified):**

```
Before: metadataStore → backendClient → ydocManager → workspaceService → syncService → calendarReminderService
After:  metadataStore → httpClient → noteStore → calendarReminderService
```

**IPC handler changes:**

| Category | Before | After |
|---|---|---|
| Note CRUD | workspaceService.createNote/loadNote/saveNote/deleteNote (filesystem) | noteStore for metadata; content lives in renderer's Y.Doc |
| Note org | workspaceService.moveNote/moveFolder/renameFolder/deleteFolder (filesystem) | noteStore path updates |
| Listing | workspaceService.listNotes/listFolders (reads all .md files) | noteStore.listNotes/listFolders (SQLite query) |
| Snapshot | syncService.getSnapshot (indexes workspace, reads all files) | noteStore.getSnapshot (SQLite query, no I/O) |
| Templates | workspaceService.listTemplates/createTemplate/readTemplateContent (filesystem) | noteStore with is_template filter |
| Auth | syncService.loginWithPassword/loginWithOidc (gRPC via backendClient) | httpClient.login/oidc (REST) |
| AI Chat | backendClient.streamSendMessage (gRPC stream) | httpClient.sendMessage (SSE stream) |
| Calendar | backendClient.* (gRPC) | httpClient.* (REST) |
| Attachments | backendClient.uploadAttachment/resolveAttachmentUrl (HTTP already) | httpClient.uploadAttachment/resolveAttachmentUrl (same logic) |
| Sync | syncService.syncNow/fullSync (gRPC push/pull) | Remove — Hocuspocus handles content sync; lightweight REST sync for metadata |
| File watcher | chokidar watching workspace | Remove entirely |
| Import | N/A (workspace directory was the import) | New: importService.importFolder |

**Key behavior change for `loadNote`:** Currently returns markdown read from disk. In the new model, the main process doesn't have note content — the renderer's Y.Doc (IndexedDB) has it. `loadNote` returns metadata only (id, path, title, pinned). The editor gets content from the Y.Doc via SyncProvider.

---

## Section 5: Import Feature

**User flow:**

1. Settings dialog (or menu) → "Import Notes" button
2. Native folder picker dialog opens
3. App recursively scans for `.md` files
4. Shows confirmation: "Found 47 notes and 3 templates. Import?"
5. Creates notes in SQLite + bootstraps Y.Docs
6. If online, syncs to backend via Hocuspocus + REST metadata push

**Import logic:**

- Recursively finds all `.md` files in selected directory
- Directory structure maps to virtual paths: `projects/design.md` → path `projects/design`
- Files inside a `templates/` directory get `is_template=1`
- Title extracted from first `# ` heading, falls back to filename
- Duplicate path handling: appends `-1`, `-2` suffix
- Each note gets a new cuid, Y.Doc bootstrapped from parsed markdown
- Repeatable: importing the same folder again creates new notes (no dedup by content)
- Handles attachments: noted for future offline attachment support, not in this refactor

**Where it runs:** Main process — it needs filesystem access to read the .md files and SQLite access to create note rows. Sends Y.Doc state to renderer via IPC so IndexedDB gets populated.

---

## Section 6: Offline Behavior

**Fully offline (no backend):**

- List/create/delete/move/rename/pin notes — all via SQLite in main process
- Edit notes — Y.Doc in IndexedDB, no network needed
- Search by title — SQLite query
- Search by content — SQLite `plain_text` column (updated by renderer on each content change, debounced)
- AI chat — not available (requires backend)
- Calendar — not available (requires backend)
- Attachments — not available (requires backend); future offline attachment support noted
- Templates — fully available (SQLite + IndexedDB)

**Reconnecting after offline:**

- Hocuspocus provider auto-reconnects, Y.Doc changes merge via CRDT (already handled)
- Metadata sync: on reconnect, push any locally-created/deleted/moved notes to backend via REST. Backend is authoritative for conflicts — if a note was deleted on another device while offline, the delete wins. New notes always succeed.

**First launch (no backend configured):**

- App works immediately — create notes, edit, organize, all local
- Connect to backend later via settings, existing notes sync up

---

## Section 7: Backend REST API Design

All endpoints live under `/api/` on the existing Fastify HTTP server (port 4000). Hocuspocus WebSocket, SSE (chat), and REST all share the same server and port. Auth via `Authorization: Bearer <token>` header.

**Notes metadata:**

```
GET    /api/notes              — list all notes (id, path, title, pinned, is_template, timestamps)
POST   /api/notes              — create note { path, title, isTemplate? }
PATCH  /api/notes/:id          — update metadata { path?, title?, pinned?, deleted? }
DELETE /api/notes/:id          — hard delete
POST   /api/notes/import       — bulk create from import [{ path, title, isTemplate, markdown }]
GET    /api/notes/sync?since=  — fetch changes since timestamp (for offline reconciliation)
```

**AI Chat (replacing gRPC AiService):**

```
GET    /api/ai/config                          — get AI config
PUT    /api/ai/config                          — update AI config
POST   /api/ai/conversations                   — create conversation
GET    /api/ai/conversations                   — list conversations
DELETE /api/ai/conversations/:id               — delete conversation
GET    /api/ai/conversations/:id/messages      — get messages
POST   /api/ai/conversations/:id/messages      — send message (SSE streaming response)
POST   /api/ai/embed                           — trigger embedding
```

**Calendar (replacing gRPC CalendarService):**

```
GET    /api/calendar/status                    — connection status
POST   /api/calendar/oauth/start               — start OAuth flow
POST   /api/calendar/disconnect                — disconnect account
GET    /api/calendar/calendars                  — list calendars
POST   /api/calendar/subscribe                  — subscribe to calendar
DELETE /api/calendar/subscribe/:id              — unsubscribe
PATCH  /api/calendar/subscribe/:id              — update subscription
POST   /api/calendar/ics                        — add ICS subscription
DELETE /api/calendar/ics/:id                    — remove ICS
PATCH  /api/calendar/ics/:id                    — update ICS
GET    /api/calendar/events                     — fetch events (query params: start, end, calendarIds)
POST   /api/calendar/events                     — create event
PATCH  /api/calendar/events/:id                 — update event
DELETE /api/calendar/events/:id                 — delete event
POST   /api/calendar/events/:id/rsvp            — RSVP
```

**Auth (mostly exists already):**

```
POST   /api/auth/login                         — password login
POST   /api/auth/oidc/start                    — start OIDC flow
POST   /api/auth/oidc/callback                 — OIDC callback
POST   /api/auth/refresh                       — refresh token
GET    /api/auth/providers                      — list auth providers (already exists)
```

---

## Section 8: Testing Strategy

### Desktop (main process)

- **`note-store.mjs`** — Unit tests: CRUD operations against in-memory SQLite. Folder derivation from paths. Duplicate path handling.
- **`http-client.mjs`** — Unit tests with mocked fetch: auth flow, token refresh on 401, SSE parsing for chat streaming.
- **`import-service.mjs`** — Unit tests: reads a temp directory of .md files, verifies correct notes created in SQLite with proper paths/titles/template flags.

### Backend (REST controllers)

- Notes metadata controller — Integration tests: create, list, update, delete notes. Bulk import. Sync-since query.
- AI Chat controller — Integration tests: conversation CRUD, SSE message streaming.
- Calendar controller — Integration tests: mirror existing gRPC test coverage.

### End-to-end

- Offline: create notes, edit, verify content persists across app restart (IndexedDB)
- Online: verify Hocuspocus syncs content to Postgres, REST syncs metadata
- Import: pick folder, verify notes appear in sidebar with correct tree structure
- Migration: existing users with workspace directories can import their notes
