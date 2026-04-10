# Slate Simplification Analysis

## Current State Summary

| Component     | Stack                                             | LOC    | Complexity                 |
| ------------- | ------------------------------------------------- | ------ | -------------------------- |
| Core Backend  | Fastify 5, Prisma, pg-boss, Hocuspocus, LangChain | ~9K    | Medium                     |
| Admin Backend | Express, AdminJS, React 18                        | ~1.5K  | Low (but separate service) |
| Desktop App   | Electron 35, React 19, Vite, Tiptap, Yjs          | ~11.5K | Medium-High                |
| Shared Lib    | Yjs, ProseMirror, markdown-it                     | ~1.6K  | Low                        |
| Database Lib  | Prisma schema + migrations                        | ~333   | Low                        |

**Total: ~24K LOC across 5 packages, 2 backend services, 1 desktop app.**

The project runs 2 separate Node.js backends, uses Fastify with 61 endpoints, maintains Yjs CRDT sync across 3 layers (IndexedDB, Hocuspocus WebSocket, HTTP API), and has a LangChain-based AI pipeline.

---

## ~~Proposal 1: Backend Framework~~ DONE

Completed. The core backend uses Fastify 5 with plugins, route files, and preHandler hooks. Services are plain classes with constructor-injected dependencies.

---

## ~~Proposal 2: Merge Admin Backend into Core Backend~~ DONE

## Proposal 3: Use RxDB

### Current Data/Sync Architecture

```
Desktop (Renderer)
├── Yjs Y.Doc (in-memory CRDT document)
├── IndexedDB (y-indexeddb, offline persistence)
├── Hocuspocus Provider (WebSocket sync to server)
└── IPC → Electron Main Process
    ├── SQLite metadata-store (notes table, settings, folders, shortcuts)
    └── HTTP client (REST API calls for CRUD, sync, auth)

Server
├── Hocuspocus Server (WebSocket CRDT sync)
├── PostgreSQL via Prisma (notes, users, CRDT state blobs, embeddings)
└── pg-boss (async job queue)
```

That's **5 storage/sync layers** on the client and **3 on the server**. Every note touches: Yjs → IndexedDB → Hocuspocus → PostgreSQL. Metadata goes: SQLite → HTTP → PostgreSQL.

### Assessment: Valid — RxDB replaces all client-side storage and sync

RxDB becomes the **single local database** on the desktop, replacing SQLite, IndexedDB (y-indexeddb), Hocuspocus, Yjs, and custom sync. Everything that was previously spread across 5 storage layers consolidates into RxDB collections with built-in replication.

**SQLite is removed entirely.** The only local-only values (auth tokens, backend URL) go in a simple JSON file via `electron-store` or plain `fs.writeFileSync` to `userData/config.json`.

**Calendar, AI chat, conversations, attachments, search stay as REST API calls.** These are server-side features — no offline sync needed, just API requests.

### What RxDB replaces

| Current Layer         | What It Does                                    | RxDB Replacement                       |
| --------------------- | ----------------------------------------------- | -------------------------------------- |
| SQLite metadata store | Notes, folders, settings, sync state, shortcuts | RxDB collections (notes, settings)     |
| y-indexeddb           | Offline Yjs state persistence                   | RxDB offline-first storage (built-in)  |
| Hocuspocus WebSocket  | Real-time CRDT relay for every edit             | RxDB replication (HTTP or WebSocket)   |
| Yjs CRDT              | Character-level text merge                      | RxDB conflict handler (document-level) |
| Custom HTTP sync      | Note CRUD + polling for changes                 | RxDB replication protocol (built-in)   |

### What stays as REST API (no RxDB)

| Feature          | Why No RxDB                                                       |
| ---------------- | ----------------------------------------------------------------- |
| Calendar         | Server-side Google Calendar / ICS integration, no offline editing |
| AI conversations | Server-side LLM calls, streaming responses                        |
| Attachments      | Upload/download, server-side storage                              |
| Auth             | Login, tokens, OIDC — server-side                                 |
| Admin            | User management, settings — server-side                           |
| Search           | Full-text + vector search — server-side                           |

### What goes in a flat JSON file (no database needed)

| Data                       | Why Not RxDB                                 |
| -------------------------- | -------------------------------------------- |
| Auth tokens (JWT, refresh) | Local-only, security-sensitive, never synced |
| Backend URL / endpoint     | Local-only, per-device configuration         |

These are 2-3 key-value pairs. A JSON file in Electron's `userData` directory is sufficient — no library needed beyond `fs`.

### Collaborative editing: Yjs as a narrow overlay (future)

For the normal case (single user, multiple devices), RxDB handles everything including note content. No CRDT needed — RxDB's conflict handler resolves the rare case where two devices edit the same note before syncing (e.g. latest `updatedAt` wins).

For the future case (two users editing the same shared note simultaneously), Yjs activates **only for that session:**

```
Normal editing (95% of the time):
  Tiptap → save to RxDB → RxDB replicates to server → other devices pull

Concurrent multi-user editing (future, rare):
  Tiptap → Yjs Y.Doc → lightweight WebSocket → character-level merge
  (Yjs only active while 2+ editors have the same note open)
```

Yjs becomes a **feature you add later**, scoped to one interaction pattern. Not a system-wide sync backbone.

### Proposed Architecture

```
Desktop (Renderer)
├── RxDB (IndexedDB backend)
│   ├── notes collection (content + metadata, offline-first, reactive)
│   └── settings collection (keyboard shortcuts, preferences — synced across devices)
├── RxDB replication → Server replication endpoint
├── Tiptap editor → saves to RxDB on change (debounced)
└── REST API client (calendar, AI, auth, attachments, search, admin)

Desktop (Main Process)
└── config.json (auth tokens, backend URL — local-only, never synced)

Server
├── Fastify
│   ├── RxDB replication endpoint (/api/replication)
│   ├── REST routes (calendar, AI, auth, attachments, search, admin)
│   └── Static admin UI
├── PostgreSQL via Prisma
└── pg-boss (job queue)
```

**What gets removed:**

- `yjs`, `y-indexeddb`, `y-prosemirror`, `y-protocols` (8 packages total with sub-deps)
- `@hocuspocus/server`, `@hocuspocus/provider`, `@hocuspocus/extension-database`
- `@tiptap/extension-collaboration`
- `better-sqlite3` (or equivalent SQLite driver)
- SQLite metadata store (`metadata-store.mjs`, 472 lines)
- SyncProvider context
- Custom sync state machine (DeviceCursor, state vectors, sync status tracking)

**What gets added:**

- `rxdb` + storage plugin (IndexedDB)
- RxDB replication endpoint on the server (~100-200 lines)
- RxDB collection schemas (notes, settings) + conflict handler
- Simple JSON config file for auth tokens (~20 lines)

**Net result:** ~12 packages removed, 1-2 added. SQLite gone. One unified local database (RxDB) with built-in replication. Server-side features stay as simple REST.

---

## ~~Proposal 4: Component Decomposition (<500 lines)~~ DONE

## Decisions (Locked In)

Based on project goals and constraints, the following are **decided**:

| Decision                             | Rationale                                                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keep LangChain**                   | Value grows as tools expand; human-in-the-loop support via LangGraph is needed                                                                       |
| **Keep pg-boss**                     | Persistent, separate layer; critical for bulk imports and file processing                                                                            |
| **Keep OIDC in DB**                  | Self-hosters love SSO; DB-stored config enables admin UI management. Future: seed from .env/config file                                              |
| **Keep Password + TOTP + OIDC**      | Full auth stack stays, it's already built and self-hosters expect it                                                                                 |
| **Add Zustand**                      | Replace 51+ useState hooks in App.tsx with proper state management                                                                                   |
| **Single user, multi-device**        | Primary use case. Future-ready for note sharing with concurrent editing                                                                              |
| **RxDB for all client-side storage** | Replaces SQLite + Yjs + Hocuspocus + IndexedDB + custom sync. Notes + settings collections with built-in replication. Auth tokens in flat JSON file. |
| **REST API for non-note features**   | Calendar, AI chat, attachments, search, admin — server-side only, no offline sync needed                                                             |
| **No CRDT**                          | RxDB conflict handler is sufficient. Yjs added later only if concurrent multi-user editing of same note is needed                                    |
| **No SQLite**                        | RxDB replaces it. Auth tokens + backend URL in a simple JSON config file.                                                                            |
| **CLI admin tool**                   | Good idea, but deferred — not part of this refactor                                                                                                  |

---

## ~~Additional Recommendation: Add Zustand:~~ DONE

## Prioritized Migration Plan

### Phase 1: Consolidate Backend (structural simplification)

**Goal:** 2 services → 1, merge admin backend

1. Merge admin endpoints into core backend
2. Delete `apps/admin-backend/` entirely (remove AdminJS, Express, React 18 dependencies)
3. Preserve: Prisma, pg-boss, LangChain, all auth (password + TOTP + OIDC)
4. Build minimal admin UI as static SPA served by Fastify (or keep as separate Vite build)

Note: Core backend already uses Fastify (Proposal 1 completed).

**Result:** 1 backend service, 1 fewer Docker container, simpler deployment.

```
Before:                          After:
├── apps/                        ├── apps/
│   ├── core-backend/ (Fastify)  │   ├── backend/ (Fastify)
│   ├── admin-backend/ (Express) │   │   ├── src/routes/
│   └── desktop/                 │   │   ├── src/services/
└── ...                          │   │   └── src/plugins/
                                 │   └── desktop/
                                 └── ...
```

### Phase 2: Replace All Client Storage with RxDB (biggest complexity win)

**Goal:** Replace Yjs + Hocuspocus + SQLite + IndexedDB + custom sync with RxDB as the single client-side database

1. Define RxDB collections:

   ```typescript
   // Notes collection — synced across devices
   const notesSchema = {
     version: 0,
     primaryKey: "id",
     type: "object",
     properties: {
       id: { type: "string", maxLength: 36 },
       title: { type: "string" },
       path: { type: "string" },
       content: { type: "string" }, // Tiptap JSON or markdown
       plainText: { type: "string" }, // For local search
       pinned: { type: "boolean" },
       deleted: { type: "boolean" }, // Soft delete for sync
       updatedAt: { type: "number" }, // Epoch ms, used for conflict resolution
       createdAt: { type: "number" },
     },
     required: ["id", "title", "updatedAt"],
     indexes: ["updatedAt", "path"],
   };

   // Settings collection — synced across devices
   const settingsSchema = {
     version: 0,
     primaryKey: "key",
     type: "object",
     properties: {
       key: { type: "string", maxLength: 100 },
       value: { type: "string" }, // JSON-encoded value
       updatedAt: { type: "number" },
     },
     required: ["key", "value", "updatedAt"],
   };
   ```

2. Implement RxDB replication endpoint on Fastify backend:
   - Server-side handler that maps RxDB replication protocol to Prisma/PostgreSQL
   - Push: client sends changed docs → server upserts
   - Pull: server returns docs changed since client's last checkpoint
   - Conflict handler: latest `updatedAt` wins (server resolves)
3. Replace desktop storage entirely:
   - Remove Hocuspocus provider, SyncProvider context, y-indexeddb
   - Remove SQLite metadata store (`metadata-store.mjs`, 472 lines) and `better-sqlite3`
   - Tiptap saves content to RxDB document on change (debounced ~2-5s)
   - RxDB replication runs continuously in background
   - Reactive queries drive the UI (note list auto-updates when RxDB changes)
   - Settings (keyboard shortcuts, preferences) sync via RxDB settings collection
4. Auth tokens + backend URL → simple JSON config file:
   - `userData/config.json` — read/write via `fs` in Electron main process
   - ~20 lines of code, no library needed
5. Remove packages:
   - `yjs`, `y-indexeddb`, `y-prosemirror`, `y-protocols`
   - `@hocuspocus/server`, `@hocuspocus/provider`, `@hocuspocus/extension-database`
   - `@tiptap/extension-collaboration`
   - `better-sqlite3` (or equivalent SQLite driver)

**Result:** One local database (RxDB). One sync system. Offline-first. Reactive. No WebSocket server. No CRDT. No SQLite. ~12 packages removed, 1-2 added.

**Future collaborative editing path:** When two users need to edit the same shared note simultaneously, add Yjs as a narrow overlay for that session only. The RxDB foundation doesn't change — Yjs just provides the real-time merge layer on top during active co-editing.

### Phase 3: Frontend Decomposition (code quality)

**Goal:** No file over 500 lines, proper state management

1. Add Zustand, create stores:
   - `app-store.ts` — selectedNoteId, sidebarMode, view state
   - `sync-store.ts` — connection status, sync state per note
   - `ui-store.ts` — dialog visibility, sidebar width, transient UI state
2. Refactor App.tsx (2,106 → ~200 lines):
   - Extract feature views (NotesView, CalendarView, ChatView)
   - Extract DialogManager
   - App.tsx becomes shell: providers + layout + routing
3. Decompose large components:
   - ChatSidebar.tsx (1,098) → ConversationList + ChatMessages + ChatInput + useChatHook
   - CalendarView.tsx (923) → MonthGrid + WeekView + DayView + EventCard
   - SettingsDialog.tsx (897) → ConnectionPanel + AuthPanel + ShortcutsPanel + AiConfigPanel
4. Split api.ts (1,021) by domain: notes-api, calendar-api, ai-api, auth-api, attachments-api

**Result:** Maintainable components, predictable state flow, easy onboarding for contributors.

### Phase 4: Admin UI Rebuild (polish)

**Goal:** Simple, built-in admin panel without AdminJS overhead

1. Build admin UI as a lightweight React SPA (est. ~500-800 LOC):
   - User management (list, create, edit)
   - OIDC provider configuration
   - Storage backend settings
   - Calendar OAuth setup
   - Feature toggles (account creation, password auth)
2. Serve as static files from Fastify at `/admin`
3. Use the same UI primitives as desktop (Radix + Tailwind)

**Result:** No AdminJS dependency, no React 18 conflict, admin UI ships with the backend.

---

## Impact Summary

| Change                           | Complexity Reduction | Effort     | Risk     |
| -------------------------------- | -------------------- | ---------- | -------- |
| Merge admin backend              | Medium               | Low        | Very Low |
| ~~Fastify migration~~            | ~~Done~~             | ~~Done~~   | ~~Done~~ |
| RxDB replaces all client storage | Very High            | Medium     | Low      |
| Add Zustand                      | Medium               | Low        | Very Low |
| Component decomposition          | Medium               | Low-Medium | Very Low |
| Admin UI rebuild                 | Low                  | Medium     | Low      |

**Total estimated reduction:**

- **Dependencies to remove:** Yjs, y-indexeddb, y-prosemirror, y-protocols, @hocuspocus/_ (3), @tiptap/extension-collaboration, better-sqlite3, AdminJS, @adminjs/_ (3), React 18 — ~11 packages
- **Dependencies added:** rxdb, zustand — 2 packages
- **Services:** 2 → 1 backend
- **Client databases:** 2 (SQLite + IndexedDB) → 1 (RxDB) + a flat JSON config file
- **Sync layers:** 5 (Yjs + IndexedDB + Hocuspocus + SQLite + HTTP) → 1 (RxDB with built-in replication)
- **Backend LOC:** ~14.5K → ~9K (estimated)
- **Desktop storage code removed:** ~472 lines (metadata-store.mjs) + sync state machine
- **Largest frontend file:** 2,106 → ~500 lines

---
