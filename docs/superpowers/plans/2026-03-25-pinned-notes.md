# Pinned Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pinned notes feature — users can pin notes to a dedicated section at the top of the sidebar, with pin state synced across devices via the core-backend.

**Architecture:** `pinned` boolean field threaded through: proto messages → Prisma schema → backend push/pull handlers → desktop SQLite → workspace service → IPC → React UI. Pin/unpin via right-click context menu + hover icon. Pinned notes appear in a "Pinned" section at the top of the sidebar and remain in their original folder.

**Tech Stack:** Protobuf (gRPC), Prisma (PostgreSQL), NestJS, Electron IPC, React, SQLite

**Spec:** `docs/superpowers/specs/2026-03-25-pinned-notes-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/proto/slate.proto` | Add `bool pinned` to 3 proto messages |
| Modify | `apps/desktop/electron/proto/slate.proto` | Same (kept in sync) |
| Modify | `packages/server-db/prisma/schema.prisma` | Add `pinned` to Document model |
| Create | `packages/server-db/prisma/migrations/*/migration.sql` | Prisma migration |
| Modify | `apps/core-backend/src/documents/documents.controller.ts` | Add `pinned` to payload type |
| Modify | `apps/core-backend/src/documents/documents.service.ts` | Handle `pinned` in push/pull |
| Modify | `apps/desktop/electron/services/metadata-store.mjs` | Add `pinned` column + upsert support |
| Modify | `apps/desktop/electron/services/workspace-service.mjs` | Include `pinned` in materializeRow, createOrUpdateRow, writeRemoteNote |
| Modify | `apps/desktop/electron/services/sync-service.mjs` | Pass `pinned` through push/pull |
| Modify | `apps/desktop/electron/main.mjs` | Add `togglePinNote` IPC handler |
| Modify | `apps/desktop/electron/preload.mjs` | Expose `togglePinNote` |
| Modify | `packages/shared/src/index.ts` | Add `pinned` to LocalNoteSummary |
| Modify | `apps/desktop/src/lib/api.ts` | Add `togglePinNote` function + interface |
| Modify | `apps/desktop/src/components/NoteTree.tsx` | Pinned section, context menu, hover icon |
| Modify | `apps/desktop/src/App.tsx` | Wire up handleTogglePin, pass pinned notes to NoteTree |
| Modify | `apps/desktop/src/styles.css` | Pinned section + pin icon styles |

---

### Task 1: Proto + shared types

**Files:**
- Modify: `packages/proto/slate.proto`
- Modify: `apps/desktop/electron/proto/slate.proto`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add `bool pinned` to proto messages**

In both `packages/proto/slate.proto` and `apps/desktop/electron/proto/slate.proto`, add `bool pinned` to three messages. Use the next available field number for each.

In `PushDocumentUpdateRequest` (currently fields 1-6), add after field 6:
```proto
bool pinned = 7;
```

In `PushDocumentUpdateResponse` (currently fields 1-4), add after field 4:
```proto
bool pinned = 5;
```

In `DocumentEvent` (currently fields 1-5), add after field 5:
```proto
bool pinned = 6;
```

- [ ] **Step 2: Add `pinned` to `LocalNoteSummary` in shared types**

In `packages/shared/src/index.ts`, add `pinned: boolean` to the `LocalNoteSummary` interface after the `syncState` field:

```typescript
pinned: boolean;
```

- [ ] **Step 3: Verify shared package builds**

Run: `npm run build --workspace @slate/shared`
Expected: Build succeeds

---

### Task 2: Backend schema + service

**Files:**
- Modify: `packages/server-db/prisma/schema.prisma`
- Create: Prisma migration
- Modify: `apps/core-backend/src/documents/documents.controller.ts`
- Modify: `apps/core-backend/src/documents/documents.service.ts`

- [ ] **Step 1: Add `pinned` to Prisma Document model**

In `packages/server-db/prisma/schema.prisma`, add to the `Document` model (after the `embedded` field):

```prisma
pinned    Boolean  @default(false)
```

- [ ] **Step 2: Generate Prisma migration**

Run: `DATABASE_URL='postgresql://slate:slate@localhost:5435/slate?schema=public' npx prisma migrate dev --name add_pinned --schema packages/server-db/prisma/schema.prisma`
Expected: Migration created and applied

- [ ] **Step 3: Regenerate Prisma client**

Run: `make db-prisma-generate`
Expected: Prisma client regenerated

- [ ] **Step 4: Add `pinned` to controller payload type**

In `apps/core-backend/src/documents/documents.controller.ts`, add `pinned` to the `pushDocumentUpdate` payload type. Find the existing type (around line 15-22):

```typescript
    clientId: string;
    documentId: string;
    path: string;
    deleted: boolean;
    crdtUpdate: Buffer | Uint8Array;
    clientStateVector?: Buffer | Uint8Array;
```

Add after `deleted`:

```typescript
    pinned: boolean;
```

- [ ] **Step 5: Update `pushDocumentUpdate` in documents.service.ts**

Three changes in `apps/core-backend/src/documents/documents.service.ts`:

**A. Add `pinned` to the `metadataChanged` check** (around line 94-96). Change:

```typescript
      const metadataChanged = !existing
        || existing.path !== nextPath
        || existing.deleted !== payload.deleted;
```

To:

```typescript
      const metadataChanged = !existing
        || existing.path !== nextPath
        || existing.deleted !== payload.deleted
        || existing.pinned !== (payload.pinned ?? false);
```

**B. Add `pinned` to the update data** (around line 123-131). Add `pinned: payload.pinned ?? false,` after `deleted: payload.deleted,`:

```typescript
            data: {
              path: nextPath,
              title: nextTitle,
              markdown,
              plainText,
              deleted: payload.deleted,
              pinned: payload.pinned ?? false,
              crdtState: new Uint8Array(mergedState),
              serverSeq: nextServerSeq,
              embedded: false,
            },
```

**C. Add `pinned` to the create data** (around line 134-147). Same addition after `deleted`:

```typescript
            data: {
              id: payload.documentId,
              userId,
              path: nextPath,
              title: nextTitle,
              markdown,
              plainText,
              deleted: payload.deleted,
              pinned: payload.pinned ?? false,
              crdtState: new Uint8Array(mergedState),
              serverSeq: nextServerSeq,
              embedded: false,
            },
```

- [ ] **Step 6: Update `pullDocumentEvents` return mapping**

In `apps/core-backend/src/documents/documents.service.ts`, find the `mapped` array (around line 243-249). Add `pinned`:

```typescript
    const mapped = documents.map((document) => ({
      documentId: document.id,
      path: document.path,
      deleted: document.deleted,
      pinned: document.pinned,
      serverSeq: Number(document.serverSeq),
      crdtState: document.crdtState ?? Buffer.alloc(0),
    }));
```

- [ ] **Step 7: Verify backend builds**

Run: `npm run lint --workspace @slate/core-backend`
Expected: No errors

---

### Task 3: Desktop metadata store + workspace service

**Files:**
- Modify: `apps/desktop/electron/services/metadata-store.mjs`
- Modify: `apps/desktop/electron/services/workspace-service.mjs`

- [ ] **Step 1: Add `pinned` column migration in metadata-store.mjs**

In `apps/desktop/electron/services/metadata-store.mjs`, add after the `disk_size` migration (after line 54):

```javascript
    try { this.db.exec("ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0"); } catch {}
```

- [ ] **Step 2: Add `pinned` to upsertNote INSERT and ON CONFLICT**

In `apps/desktop/electron/services/metadata-store.mjs`, update the `upsertNote` method (lines 76-103).

Change the INSERT column list to include `pinned`:
```sql
INSERT INTO notes(id, relative_path, title, accepted_revision, server_seq, sync_state, dirty, deleted, updated_at, disk_content_hash, disk_mtime_ms, disk_size, pinned)
VALUES (@id, @relativePath, @title, @acceptedRevision, @serverSeq, @syncState, @dirty, @deleted, @updatedAt, @diskContentHash, @diskMtimeMs, @diskSize, @pinned)
```

Add to the ON CONFLICT SET clause:
```sql
          pinned = excluded.pinned
```

And in the `.run()` call, add the default:
```javascript
        pinned: note.pinned ?? 0,
```

- [ ] **Step 3: Add `setPinned` method to metadata-store.mjs**

Add after the `upsertNote` method:

```javascript
  setPinned(noteId, pinned) {
    this.db.prepare("UPDATE notes SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, noteId);
  }
```

- [ ] **Step 4: Add `pinned` to materializeRow in workspace-service.mjs**

In `apps/desktop/electron/services/workspace-service.mjs`, update the return object in `materializeRow()` (around line 727-738). Add `pinned: Boolean(row.pinned)` after `syncState`:

```javascript
    return {
      id: row.id,
      title: row.title,
      path: relativePath,
      preview: previewFromText(plainText),
      markdown,
      plainText,
      updatedAt: row.updated_at ?? row.updatedAt,
      acceptedRevision: row.server_seq ?? row.accepted_revision ?? row.acceptedRevision,
      deleted: Boolean(row.deleted),
      syncState: row.sync_state ?? row.syncState,
      pinned: Boolean(row.pinned),
    };
```

- [ ] **Step 5: Add `pinned` to createOrUpdateRow in workspace-service.mjs**

In `apps/desktop/electron/services/workspace-service.mjs`, update the `createOrUpdateRow` method signature (line 682) to accept `pinned`:

```javascript
  createOrUpdateRow({ id, relativePath, markdown, title, dirty, syncState, serverSeq, pinned }) {
```

Add `pinned` to the `nextRow` object (around line 688-701), preserving existing value if not provided:

```javascript
    const nextRow = {
      id: id ?? existing?.id ?? crypto.randomUUID(),
      relativePath,
      title: nextTitle,
      acceptedRevision: nextServerSeq,
      serverSeq: nextServerSeq,
      syncState,
      dirty,
      deleted: 0,
      updatedAt: new Date().toISOString(),
      diskContentHash: snap.diskContentHash,
      diskMtimeMs: snap.diskMtimeMs,
      diskSize: snap.diskSize,
      pinned: pinned ?? existing?.pinned ?? 0,
    };
```

- [ ] **Step 6: Add `pinned` to writeRemoteNote in workspace-service.mjs**

In `apps/desktop/electron/services/workspace-service.mjs`, update the `createOrUpdateRow` call inside `writeRemoteNote()` (around line 525-533) to pass `pinned`:

```javascript
    this.createOrUpdateRow({
      id: note.id,
      relativePath,
      markdown: note.markdown,
      title: note.title,
      dirty: 0,
      syncState: "idle",
      serverSeq: note.serverSeq ?? note.acceptedRevision,
      pinned: note.pinned ?? 0,
    });
```

- [ ] **Step 7: Run desktop tests**

Run: `make desktop-test`
Expected: Tests pass

---

### Task 4: Desktop sync service

**Files:**
- Modify: `apps/desktop/electron/services/sync-service.mjs`

- [ ] **Step 1: Add `pinned` to pushPendingNotes payload**

In `apps/desktop/electron/services/sync-service.mjs`, update the `pushDocumentUpdate` call inside `pushPendingNotes()` (around line 593-600). Add `pinned: Boolean(row.pinned)`:

```javascript
      const response = await this.handleAuthenticatedCall(() =>
        this.backendClient.pushDocumentUpdate({
          clientId,
          documentId: noteId,
          path: row.relative_path,
          deleted,
          pinned: Boolean(row.pinned),
          crdtUpdate,
          clientStateVector,
        }),
      );
```

- [ ] **Step 2: Add `pinned` to pullRemoteEvents writeRemoteNote call**

In `apps/desktop/electron/services/sync-service.mjs`, update the `writeRemoteNote` call inside `pullRemoteEvents()` (around line 689-696). Add `pinned`:

```javascript
        await this.workspaceService.writeRemoteNote({
          id: document.documentId,
          title: pathFromMarkdownFallback(markdown, document.path),
          path: document.path,
          markdown,
          serverSeq: document.serverSeq,
          acceptedRevision: document.serverSeq,
          pinned: document.pinned ? 1 : 0,
        });
```

---

### Task 5: IPC layer (main + preload + api)

**Files:**
- Modify: `apps/desktop/electron/main.mjs`
- Modify: `apps/desktop/electron/preload.mjs`
- Modify: `apps/desktop/src/lib/api.ts`

- [ ] **Step 1: Add `togglePinNote` IPC handler in main.mjs**

In `apps/desktop/electron/main.mjs`, add a new IPC handler near the other note handlers (after the `deleteNote` handler). Find the pattern of existing handlers and add:

```javascript
  ipcMain.handle("desktop:togglePinNote", async (_event, noteId, pinned) => {
    metadataStore.setPinned(noteId, pinned);
    metadataStore.markDirty(noteId);
  });
```

- [ ] **Step 2: Expose `togglePinNote` in preload.mjs**

In `apps/desktop/electron/preload.mjs`, add to the `contextBridge.exposeInMainWorld` object:

```javascript
  togglePinNote: (noteId, pinned) => ipcRenderer.invoke("desktop:togglePinNote", noteId, pinned),
```

- [ ] **Step 3: Add `togglePinNote` to the frontend API**

In `apps/desktop/src/lib/api.ts`, add `togglePinNote` to the `DesktopApi` interface:

```typescript
  togglePinNote(noteId: string, pinned: boolean): Promise<void>;
```

Add the exported function:

```typescript
export function togglePinNote(noteId: string, pinned: boolean): Promise<void> {
  return desktopApi().togglePinNote(noteId, pinned);
}
```

- [ ] **Step 4: Verify desktop typecheck**

Run: `make desktop-lint`
Expected: No type errors (may need to add `pinned: false` to any browser fallback mock objects in api.ts if they exist)

---

### Task 6: UI — NoteTree pinned section + context menu + hover icon

**Files:**
- Modify: `apps/desktop/src/components/NoteTree.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles.css`

- [ ] **Step 1: Add props to NoteTree for pin support**

In `apps/desktop/src/components/NoteTree.tsx`, add to the `TreeBranchProps` interface (around line 10-23):

```typescript
  onTogglePin?: (noteId: string, pinned: boolean) => void;
```

Add to the function destructuring (around line 25-30):

```typescript
  onTogglePin,
```

Also import `Pin` from lucide-react (line 2):

```typescript
import { ChevronRight, FileText, FolderOpen, Pin } from "lucide-react";
```

- [ ] **Step 2: Update context menu to include Pin/Unpin**

In `apps/desktop/src/components/NoteTree.tsx`, update `handleNoteContextMenu` (lines 90-97):

```typescript
  async function handleNoteContextMenu(e: React.MouseEvent, note: LocalNoteSummary) {
    e.preventDefault();
    const items: NativeMenuItem[] = [
      { id: "pin", label: note.pinned ? "Unpin Note" : "Pin Note" },
      { type: "separator", id: "sep", label: "" },
      { id: "delete", label: "Delete Note" },
    ];
    const selected = await showContextMenu(items);
    if (selected === "delete") void onDeleteNote(note.id);
    else if (selected === "pin") onTogglePin?.(note.id, !note.pinned);
  }
```

Update the `onContextMenu` call on the note button (line 183) to pass the full note object:

```typescript
onContextMenu={(e) => void handleNoteContextMenu(e, note)}
```

Also import `LocalNoteSummary` at the top:

```typescript
import type { LocalNoteSummary } from "@slate/shared";
```

- [ ] **Step 3: Add hover pin icon to note rows**

In `apps/desktop/src/components/NoteTree.tsx`, inside the note button (between `note-row__copy` div and the closing `</button>`, around line 196-197), add the pin icon:

```tsx
          {onTogglePin && (
            <div
              className="note-row__pin"
              onClick={(e) => { e.stopPropagation(); onTogglePin(note.id, !note.pinned); }}
              title={note.pinned ? "Unpin" : "Pin"}
            >
              <Pin size={12} />
            </div>
          )}
```

- [ ] **Step 4: Add a dedicated pinned section component**

At the bottom of `apps/desktop/src/components/NoteTree.tsx` (before the final export or after the TreeBranch component), add a new exported component:

```tsx
export function PinnedSection({
  notes,
  selectedNoteId,
  onSelectNote,
  onDeleteNote,
  onTogglePin,
}: {
  notes: LocalNoteSummary[];
  selectedNoteId: string;
  onSelectNote: (noteId: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onTogglePin: (noteId: string, pinned: boolean) => void;
}) {
  if (notes.length === 0) return null;

  async function handleNoteContextMenu(e: React.MouseEvent, note: LocalNoteSummary) {
    e.preventDefault();
    const items: NativeMenuItem[] = [
      { id: "pin", label: "Unpin Note" },
      { type: "separator", id: "sep", label: "" },
      { id: "delete", label: "Delete Note" },
    ];
    const selected = await showContextMenu(items);
    if (selected === "delete") void onDeleteNote(note.id);
    else if (selected === "pin") onTogglePin(note.id, false);
  }

  const sorted = [...notes].sort((a, b) => basename(a.path).localeCompare(basename(b.path)));

  return (
    <div className="pinned-section">
      <div className="pinned-section__heading">Pinned</div>
      {sorted.map((note) => (
        <button
          key={note.id}
          type="button"
          className={`note-row ${note.id === selectedNoteId ? "is-active" : ""}`}
          onClick={() => void onSelectNote(note.id)}
          onContextMenu={(e) => void handleNoteContextMenu(e, note)}
          style={{ paddingLeft: "8px" }}
        >
          <div className="note-row__icon">
            <Pin size={14} />
          </div>
          <div className="note-row__copy">
            <div className="note-row__title">{basename(note.path)}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Wire up in App.tsx**

In `apps/desktop/src/App.tsx`:

**A. Import PinnedSection and togglePinNote:**

Add to the NoteTree import:
```typescript
import { TreeBranch, PinnedSection } from "./components/NoteTree";
```

Add to the api import:
```typescript
import { togglePinNote } from "./lib/api";
```

**B. Add handleTogglePin handler** (near `handleDeleteNote`):

```typescript
  async function handleTogglePin(noteId: string, pinned: boolean) {
    await togglePinNote(noteId, pinned);
    await refreshSnapshot();
  }
```

**C. Compute pinned notes** (near the existing `tree` computation, wherever `buildNoteTree` is called):

```typescript
  const pinnedNotes = snapshot.notes.filter((n) => n.pinned);
```

**D. Render PinnedSection** in the sidebar, just above the tree rendering. Find where `tree.map((node) => <TreeBranch ...>)` is rendered and add above it:

```tsx
<PinnedSection
  notes={pinnedNotes}
  selectedNoteId={selectedNoteId}
  onSelectNote={handleSelectNote}
  onDeleteNote={handleDeleteNote}
  onTogglePin={handleTogglePin}
/>
```

**E. Pass `onTogglePin` to TreeBranch:**

Add `onTogglePin={handleTogglePin}` to each `<TreeBranch>` in the tree map.

- [ ] **Step 6: Add CSS styles**

In `apps/desktop/src/styles.css`, add the pinned section and pin icon styles. Find the existing `.note-row` styles and add nearby:

```css
.pinned-section {
  padding-bottom: 4px;
  border-bottom: 1px solid var(--line-soft);
  margin-bottom: 4px;
}

.pinned-section__heading {
  padding: 6px 8px 2px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  cursor: default;
  -webkit-user-select: none;
  user-select: none;
}

.note-row__pin {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-left: auto;
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0;
  cursor: pointer;
  border-radius: 3px;
}

.note-row:hover .note-row__pin {
  opacity: 1;
}

.note-row__pin:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
```

- [ ] **Step 7: Verify typecheck and visual**

Run: `make desktop-lint`
Expected: No type errors

Run: `make desktop-build`
Expected: Build succeeds
