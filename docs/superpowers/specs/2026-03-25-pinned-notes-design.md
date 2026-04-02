# Pinned Notes Design

## Context

Slate's sidebar displays notes organized in a folder tree. Users have no way to mark frequently-used notes for quick access. This feature adds the ability to pin notes, which appear in a dedicated "Pinned" section at the top of the sidebar while also remaining in their original folder location. Pin state syncs across devices via the existing sync protocol.

## Goals

- Pin/unpin notes via right-click context menu or a hover icon
- Show pinned notes in a dedicated section at the top of the sidebar
- Pinned notes also remain visible in their original folder
- Pin state syncs to the core-backend and across devices

## Data Model

### Proto (`packages/proto/slate.proto` + `apps/desktop/electron/proto/slate.proto`)

Add `bool pinned` to three existing messages:

- `PushDocumentUpdateRequest` — client sends pin state when syncing
- `PushDocumentUpdateResponse` — server echoes updated pin state
- `DocumentEvent` — server includes pin state in pull responses

Field numbers must not conflict with existing fields. Both proto files must be updated identically.

### Backend Schema (`packages/server-db/prisma/schema.prisma`)

Add to the `Document` model:

```prisma
pinned Boolean @default(false)
```

Requires a Prisma migration (`ALTER TABLE "Document" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false`).

### Desktop Metadata Store (`apps/desktop/electron/services/metadata-store.mjs`)

Add column to the `notes` table in the `migrate()` method:

```sql
ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0
```

The store already handles "column already exists" errors gracefully in migrations.

Additionally, `upsertNote()` must include `pinned` in both its INSERT column list and ON CONFLICT SET clause, and `pinned` must be included in the parameter binding. Without this, pin state would be silently dropped or reset to 0 on every upsert.

### Shared Types (`packages/shared/src/index.ts`)

Add `pinned: boolean` to the `LocalNoteSummary` interface.

## Sync Flow

Pin/unpin piggybacks on the existing sync mechanism — no new sync paths needed.

### Push (desktop → server)

When a note is pinned/unpinned:
1. Update `pinned` in the local metadata store
2. Call `markDirty(noteId)` to queue for sync
3. On next sync cycle, `pushDocumentUpdate` includes the `pinned` field (convert SQLite integer to boolean: `Boolean(row.pinned)`)
4. Backend stores it in the `Document` row and returns the updated state

### Pull (server → desktop)

When pulling remote events:
1. `DocumentEvent` includes `pinned` field
2. Desktop sync service passes `pinned` through to `writeRemoteNote` in workspace-service
3. `writeRemoteNote` includes `pinned` in the `createOrUpdateRow` call
4. `createOrUpdateRow` includes `pinned` in the `nextRow` object passed to `upsertNote()`
5. Snapshot refreshes, UI re-renders

### Backend Service (`apps/core-backend/src/documents/documents.service.ts`)

- `pushDocumentUpdate`:
  - Read `pinned` from the request payload
  - Add `pinned` to the `metadataChanged` check: `existing.pinned !== payload.pinned` (without this, a pin-only change would be treated as a noop and the write would be skipped)
  - Include `pinned` in the database upsert
- `pullDocumentEvents`: Include `pinned` in the returned `DocumentEvent` objects

### Backend Controller (`apps/core-backend/src/documents/documents.controller.ts`)

Update the payload type to include `pinned: boolean`.

### Desktop Workspace Service (`apps/desktop/electron/services/workspace-service.mjs`)

- `materializeRow()`: Include `pinned: Boolean(row.pinned)` in the returned `LocalNoteSummary` object
- `writeRemoteNote()`: Accept `pinned` parameter, pass through to `createOrUpdateRow`
- `createOrUpdateRow()`: Include `pinned` in the `nextRow` object

### Desktop Sync Service (`apps/desktop/electron/services/sync-service.mjs`)

- `pushPendingNotes`: Include `pinned: Boolean(row.pinned)` in the push request payload
- `pullRemoteEvents`: Extract `pinned` from each document event and pass it through to `writeRemoteNote()`

## IPC Layer

### Main Process (`apps/desktop/electron/main.mjs`)

Add IPC handler:

```
desktop:togglePinNote(noteId: string, pinned: boolean)
```

Handler logic:
1. Update `pinned` in metadata store (direct SQL update or a dedicated method)
2. Call `markDirty(noteId)`
3. Return void (caller refreshes snapshot)

### Preload (`apps/desktop/electron/preload.mjs`)

Expose `togglePinNote` to the renderer.

### Frontend API (`apps/desktop/src/lib/api.ts`)

- Add `togglePinNote(noteId: string, pinned: boolean)` function
- Update the `DesktopApi` interface to include `togglePinNote`
- Update browser fallback mock to include `pinned: false` in `LocalNoteSummary` shapes

## UI

### Note Tree Logic (`apps/desktop/src/lib/noteTree.ts`)

No changes to `buildNoteTree()`. Instead, the pinned notes are extracted from `snapshot.notes` by filtering on `pinned === true` in the component layer (App.tsx or NoteTree.tsx). This keeps the tree-building logic clean and avoids duplicating notes in the data structure.

### Sidebar Rendering (`apps/desktop/src/components/NoteTree.tsx`)

**Pinned section:**
- Rendered at the top of the sidebar, above the folder tree
- Only visible when there are pinned notes (no empty section)
- Small "Pinned" heading styled like existing folder headings (muted text, small font)
- Flat list of pinned notes (no folder nesting) — shows note filename only, sorted alphabetically
- Each note is clickable (same `onSelectNote` behavior)
- Each note has the same right-click context menu and hover pin icon

**Hover pin icon:**
- Small pin icon appears on the right side of any note row on hover
- Clicking it toggles pin state
- Not visible when not hovering
- Styled to match the existing sidebar aesthetic (muted color, same size as other icons)

**Right-click context menu:**
- Add "Pin Note" or "Unpin Note" (depending on current state) to the existing note context menu
- Placed above "Delete Note" in the menu

### App.tsx

- Add `handleTogglePin(noteId, pinned)` handler: calls `togglePinNote` API, then `refreshSnapshot()`
- Pass handler and pinned notes list down to NoteTree

### Styles (`apps/desktop/src/styles.css`)

- `.pinned-section` — container for the pinned section
- `.pinned-section__heading` — "Pinned" label, matching existing folder heading style
- `.note-pin-icon` — hover pin icon on note rows, positioned right, muted color, `opacity: 0` by default, `opacity: 1` on parent hover

## Edge Cases

- **Deleted pinned note:** Deleted notes are filtered out of `snapshot.notes`, so they naturally disappear from the pinned section. No special handling needed.
- **Moved/renamed pinned note:** Pins are by note ID, not path. Moving or renaming a note does not affect pin state.
- **Pin-only change with no content change:** The backend `metadataChanged` check must include `pinned` to ensure pin-only changes are persisted (see Backend Service section above).

## Files Changed

| Action | File |
|--------|------|
| Modify | `packages/proto/slate.proto` |
| Modify | `apps/desktop/electron/proto/slate.proto` |
| Modify | `packages/server-db/prisma/schema.prisma` |
| Create | `packages/server-db/prisma/migrations/<timestamp>_add_pinned/migration.sql` |
| Modify | `apps/core-backend/src/documents/documents.service.ts` |
| Modify | `apps/core-backend/src/documents/documents.controller.ts` |
| Modify | `apps/desktop/electron/services/metadata-store.mjs` |
| Modify | `apps/desktop/electron/services/sync-service.mjs` |
| Modify | `apps/desktop/electron/services/workspace-service.mjs` |
| Modify | `apps/desktop/electron/main.mjs` |
| Modify | `apps/desktop/electron/preload.mjs` |
| Modify | `packages/shared/src/index.ts` |
| Modify | `apps/desktop/src/lib/api.ts` |
| Modify | `apps/desktop/src/components/NoteTree.tsx` |
| Modify | `apps/desktop/src/App.tsx` |
| Modify | `apps/desktop/src/styles.css` |
