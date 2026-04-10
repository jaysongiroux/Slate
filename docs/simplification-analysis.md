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

## Proposal 2: Merge Admin Backend into Core Backend

### Current Admin Backend

- Separate Express app (~1.5K LOC) on port 4100
- Uses AdminJS (heavy — pulls in React 18, its own design system, formidable)
- Communicates with core backend via HTTP to `/internal/admin/` endpoints
- Separate Docker container in production
- Separate Dockerfile, separate CI job

### Assessment: Strongly valid

The core backend already has 24 `/internal/admin/` endpoints that do all the real work. The admin backend is just an AdminJS UI that calls these endpoints over HTTP. This means:

1. **Two services for one feature** — admin is just a proxy with a UI
2. **Extra deployment complexity** — separate container, port, health check
3. **Dependency bloat** — AdminJS pulls React 18 (desktop uses React 19), plus its design system, adapters, and bundling pipeline
4. **Network hop overhead** — admin UI → admin backend → core backend → database

### Concrete approach

**Option A: Simple admin routes in Fastify (recommended)**

Move the 24 admin endpoints into the core backend as regular routes behind admin auth middleware. For the UI, build a minimal admin page:

```
src/
├── routes/
│   └── admin.ts           # All admin endpoints, admin guard
└── admin-ui/              # Optional: simple static SPA
    ├── index.html
    └── admin.tsx           # React mini-app, ~500 LOC
```

The admin UI needs are simple:

- User management (list, create, edit)
- OIDC provider configuration
- Storage backend configuration
- Calendar OAuth setup
- Toggle account creation / password auth

This is maybe 4-5 forms. A single-page React app under 500 lines could handle it, served as static files from the Fastify backend.

**Option B: CLI-based admin (even simpler)**

For a self-hostable product, many users prefer CLI admin:

```bash
slate admin create-user --email admin@example.com --admin
slate admin set-storage --type s3 --bucket my-bucket
slate admin configure-oidc --provider google --client-id xxx
```

This eliminates the admin UI entirely. Configuration goes in environment variables or a config file.

### Recommendation: Merge it. Option A for GUI users, Option B as a bonus for power users.

---

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

## Proposal 4: Component Decomposition (<500 lines)

### Current Large Files

| File                | Lines | Issue                                                   |
| ------------------- | ----- | ------------------------------------------------------- |
| App.tsx             | 2,106 | 51+ useState hooks, god component                       |
| ChatSidebar.tsx     | 1,098 | Mixed concerns: conversation list + chat UI + streaming |
| api.ts              | 1,021 | 50+ IPC methods in one file                             |
| CalendarView.tsx    | 923   | Layout + grid + events + drag-drop                      |
| SettingsDialog.tsx  | 897   | 5+ settings panels in one component                     |
| CalendarSidebar.tsx | 540   | Sidebar + subscription management                       |
| NovelEditor.tsx     | 539   | Editor + extensions + slash commands                    |
| NoteTree.tsx        | 527   | Tree + drag-drop + search + context menu                |

### Assessment: Valid and straightforward

This is good hygiene. Here's a concrete decomposition plan:

**App.tsx (2,106 → ~200 lines)**

The root problem is 51+ `useState` hooks and no state management. Fix both:

1. **Extract state to Zustand store** (~150 lines):

   ```
   stores/
   ├── app-store.ts          # selectedNoteId, sidebarMode, view state
   ├── sync-store.ts         # connection status, save state
   └── ui-store.ts           # dialogs, modals, sidebar width
   ```

2. **Extract feature shells** into route-level components:

   ```
   features/
   ├── notes/
   │   └── NotesView.tsx     # Note list + editor layout
   ├── calendar/
   │   └── CalendarView.tsx  # Calendar layout (already exists, just lift out of App)
   └── chat/
       └── ChatView.tsx      # Chat layout
   ```

3. **Extract dialog orchestration**:
   ```
   components/
   └── dialogs/
       ├── DialogManager.tsx  # Renders active dialogs based on store state
       ├── SettingsDialog/
       │   ├── index.tsx
       │   ├── ConnectionPanel.tsx
       │   ├── AuthPanel.tsx
       │   ├── ShortcutsPanel.tsx
       │   ├── AiConfigPanel.tsx
       │   └── CalendarPanel.tsx
       └── ...
   ```

**App.tsx becomes:**

```tsx
function App() {
  return (
    <SyncProvider>
      <AppShell>
        <IconRail />
        <MainContent /> {/* switches on sidebarMode */}
        <DialogManager />
      </AppShell>
    </SyncProvider>
  );
}
```

**ChatSidebar.tsx (1,098 → ~300 lines)**

```
features/chat/
├── ChatView.tsx              # Layout: conversation list + active chat
├── ConversationList.tsx      # List + create/delete
├── ChatMessages.tsx          # Message display + streaming
├── ChatInput.tsx             # Composer + trigger menu
└── hooks/
    └── use-chat.ts           # Streaming, message send, conversation management
```

**CalendarView.tsx (923 → ~300 lines)**

```
features/calendar/
├── CalendarLayout.tsx        # Layout: sidebar + main view
├── MonthGrid.tsx             # Month view grid
├── WeekView.tsx              # Week view
├── DayView.tsx               # Day column
├── EventCard.tsx             # Individual event rendering
├── EventForm.tsx             # Create/edit event dialog
└── hooks/
    └── use-calendar.ts       # Event fetching, CRUD, navigation
```

**api.ts (1,021 → split by domain)**

```
lib/api/
├── index.ts                  # Re-exports all
├── notes-api.ts              # Note CRUD + sync
├── calendar-api.ts           # Calendar operations
├── ai-api.ts                 # Chat, embeddings
├── auth-api.ts               # Login, tokens
├── attachments-api.ts        # Upload/download
└── settings-api.ts           # Settings, admin
```

### Recommendation: Do it. Start with App.tsx + Zustand, then work outward.

---

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

## Additional Recommendation: Add Zustand

**Current:** 51+ `useState` hooks in App.tsx, state passed through props and context.

**Why Zustand over alternatives:**

| Library       | Bundle Size | Boilerplate | Learning Curve |
| ------------- | ----------- | ----------- | -------------- |
| Zustand       | 1.1 KB      | Minimal     | Trivial        |
| Redux Toolkit | 11 KB       | Medium      | Medium         |
| Jotai         | 2.4 KB      | Minimal     | Low            |
| MobX          | 16 KB       | Medium      | Medium         |

Zustand is the right fit: tiny, no providers needed, works with React 19, and the API is just functions.

```typescript
// stores/app-store.ts
export const useAppStore = create<AppState>((set) => ({
  selectedNoteId: null,
  sidebarMode: "notes",
  setSelectedNote: (id) => set({ selectedNoteId: id }),
  setSidebarMode: (mode) => set({ sidebarMode: mode }),
}));
```

---

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

## Self-Hosting Considerations

For open-source self-hosters, this refactor directly improves the experience:

1. **Minimal services** — One backend + one database. `docker compose up` with 2 containers (backend + postgres). No separate admin service, no MinIO required (filesystem storage by default).

2. **OIDC stays first-class** — DB-stored configuration means admins manage it through the built-in UI. Future improvement: seed from `.env` or config file for infrastructure-as-code setups.

3. **No WebSocket requirement** — RxDB replication over HTTP works through any reverse proxy, CDN, or firewall without special WebSocket configuration. This is a real pain point for self-hosters behind nginx/Caddy/Cloudflare.

4. **Clear deployment path** — One Dockerfile, one docker-compose.yml, environment variables, done.
