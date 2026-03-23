# Single-User Sync Design

## Goal

Simplify Slate sync so the desktop app and core backend support one user syncing one note library across multiple devices, with no workspaces, no sharing, and automatic CRDT-based merge behavior.

## Product Scope

This design intentionally removes:

- Workspaces
- Workspace membership
- Sharing and multi-user collaboration
- Sync behavior that depends on workspace identity
- User-facing sync configuration beyond connection, sign-in, status, and manual sync trigger

This design keeps:

- Multiple devices per user
- Local markdown files as a first-class input and output
- CRDT merge for concurrent edits
- Backend-derived markdown and plain text for search, debugging, and recovery
- Automatic background sync with a visible `Sync now` action

## Product Model

The target product model is:

- One account owns one library
- Every signed-in device syncs the same library
- No device is permanently primary
- The backend is the durable convergence point
- Local markdown files remain part of the product contract

The user experience should be:

- Edit locally with no network dependency
- Sync runs automatically in the background
- The user can trigger `Sync now`
- The app shows simple sync state: `offline`, `syncing`, `synced`, `error`

## Core Principles

### 1. CRDT is the only sync protocol

There should not be separate markdown-sync and CRDT-sync paths. All note synchronization between app and backend should happen through CRDT state exchange.

### 2. Markdown remains first-class locally

Local `.md` files are not a disposable export format. External file edits, new files, renames, and deletions remain valid inputs to the system.

### 3. Backend stores both sync truth and derived content

The backend stores canonical CRDT state and also persists derived `markdown`, `plainText`, and `path` fields so search, debugging, recovery, and indexing do not require replaying sync logic externally.

### 4. Identity is stable, path is mutable

Each note has a permanent `documentId`. File path changes do not create a new logical document.

### 5. Sync should be boring

The sync layer should aim for predictable convergence, minimal settings, and no explicit user conflict workflow for normal concurrent editing.

## Current-State Problem

The current implementation mixes two different models:

- Revision-based document sync
- Per-document CRDT sync

This causes duplicated responsibilities across desktop and backend:

- Revision counters and `lastSeenRevision`
- CRDT note sync and state vectors
- Full sync that pushes local notes and then pulls from revision `0`
- Markdown/bootstrap fallback behavior
- File watching that rebuilds CRDT state from disk

The result is a system with overlapping authorities and more state transitions than the product needs.

## Target Architecture

The simplified architecture should have four responsibilities on desktop:

### 1. Filesystem adapter

Responsible for:

- Reading and writing `.md` files
- Watching the local library for external file changes
- Mapping file events to tracked note metadata
- Applying remote path and deletion updates to disk

This responsibility belongs to the desktop `workspace-service`, though the service should eventually be renamed because it no longer represents multi-workspace behavior.

### 2. CRDT state manager

Responsible for:

- Keeping local `Y.Doc` state per note
- Bootstrapping CRDT state from markdown
- Applying local and remote updates
- Materializing markdown from CRDT state
- Persisting CRDT state locally

This responsibility belongs to the desktop `ydoc-manager`.

### 3. Sync orchestrator

Responsible for:

- Tracking local pending note changes
- Pushing note updates to the backend
- Pulling remote note events from the backend
- Maintaining the local pull cursor
- Updating sync status and retry behavior

This responsibility belongs to the desktop `sync-service`.

### 4. Thin backend transport

Responsible for:

- Issuing RPC or HTTP requests
- Returning typed responses
- Avoiding business logic

This responsibility belongs to the desktop `backend-client`.

The backend should mirror the same decomposition:

- Auth/session resolution
- Document sync and persistence
- Search/indexing
- Attachment handling

No backend path should depend on workspaces or membership once this refactor is complete.

## Simplified Sync Contract

The app-to-backend contract should reduce to three note sync operations.

### 1. PushDocumentUpdate

The client sends:

- `clientId`
- `documentId`
- `path`
- `deleted`
- `crdtUpdate`
- optional `clientStateVector`

The server:

- Authenticates the user
- Loads the current server-side CRDT state for the note, if any
- Applies the incoming update
- Materializes markdown and plain text
- Stores the merged state plus metadata
- Assigns a monotonic per-user global `serverSeq`
- Returns:
  - `serverSeq`
  - optional `serverDelta`
  - canonical `path`
  - `deleted`

This is the normal write path for:

- Editor changes
- External markdown file edits
- Renames and moves
- Tombstone deletes
- Attachment URL rewrites that modify note content

### 2. PullDocumentEvents

The client sends:

- `clientId`
- `sinceServerSeq`

The server returns changed documents since that sequence, including:

- `documentId`
- `path`
- `deleted`
- `serverSeq`
- full `crdtState` in the initial version of the design

Later, this can be optimized to per-device delta delivery, but the first implementation should prioritize correctness and simplicity.

### 3. GetDocumentSnapshot

Used for:

- Recovery of one note
- Lazy bootstrap if a note is missing locally
- Repair of a corrupted local note state

The response includes:

- `documentId`
- `path`
- `deleted`
- `serverSeq`
- full `crdtState`

## Steady-State Sync Algorithm

Desktop steady-state sync should work like this:

### Local mutation path

1. A local edit happens in the editor, or the filesystem watcher detects a markdown change.
2. Desktop updates the local Yjs state for the note.
3. The note is marked pending for sync.
4. A debounced sync batch pushes all pending notes.
5. If the backend returns a delta, the client applies it locally.
6. If note content changed as a result of merge, desktop materializes the current markdown back to disk.

### Remote mutation path

1. Desktop periodically calls `PullDocumentEvents` with `sinceServerSeq`.
2. For each returned document:
   - apply remote CRDT state
   - update or move the local file path
   - delete the local file if the event is a tombstone
   - notify the renderer if the note is open
3. Desktop advances its local `lastServerSeq`.

### Sync triggers

Automatic sync should run:

- On app launch after auth is restored
- On reconnect
- After local edits are debounced
- On an interval suitable for background convergence
- When the user clicks `Sync now`

The product should expose the manual sync trigger but not a large settings surface for intervals or behavior modes.

## First-Link and Bootstrap Behavior

The product should support merge-first bootstrap behavior.

### Case 1: Server empty, local library has notes

- Upload all local notes
- Establish pull cursor

### Case 2: Local library empty, server has notes

- Download all remote notes
- Materialize them locally

### Case 3: Both sides have notes

- Perform one-time bidirectional import
- Merge by note identity where mapping exists
- If identity mapping does not exist yet, match by normalized exact path
- If both sides have a note at the same normalized path, merge their CRDT states into one logical note
- Prefer the existing server `documentId` when a server note already exists for the matched path
- Treat unmatched local files as new notes
- Treat unmatched remote notes as notes to hydrate locally

Bootstrap should not use fuzzy title matching or content-similarity matching. Exact normalized path matching is sufficient for the first implementation and is less likely to create incorrect merges.

This avoids treating either the backend or the device as permanently authoritative while still converging all devices to the same library.

## Note Identity, Path, and Rename Rules

### Note identity

- `documentId` is stable for the life of a note
- Sync operates by `documentId`, not path

### Path

- `path` is mutable metadata
- Rename or move updates the existing note
- A path change must not be modeled as delete plus recreate

### Path collisions

If a pulled remote note wants to use a path that already exists locally for a different tracked note, desktop should preserve note identity and resolve the local file-system conflict with a deterministic suffix such as `-conflict-<device>`.

The backend should not create a second logical note just because a local device had a path collision.

## Deletion Model

Deletes should be tombstoned, not immediately purged.

A deleted note should keep:

- `documentId`
- `path`
- `deleted = true`
- last `crdtState`
- `serverSeq`

When a client receives a tombstone:

- Delete the local markdown file if it exists
- Mark the local tracked note deleted
- Keep enough local metadata to avoid resurrecting it incorrectly during replay

Backend hard deletion can be a later operational cleanup concern, but it is not part of the sync protocol.

## External Markdown File Handling

Markdown files remain a first-class input. The expected behaviors are:

### Existing tracked file changes

- Read the new markdown
- Rebuild or replace the local CRDT state for that same `documentId`
- Mark the note pending for push

### New untracked file appears

- Create a new `documentId`
- Bootstrap CRDT state from markdown
- Mark it pending for push

### Tracked file disappears

- Create a tombstone for the corresponding `documentId`
- Mark it pending for push

This keeps local file edits part of the supported editing model instead of demoting the filesystem to an implementation detail.

## Backend Data Model

The backend data model should be simplified around user ownership rather than workspaces.

### Remove

- `Workspace`
- `WorkspaceMember`
- Workspace-based document ownership
- Workspace-based client cursors

### Replace with

#### Document

- `id`
- `userId`
- `path`
- `title`
- `markdown`
- `plainText`
- `crdtState`
- `deleted`
- `serverSeq`
- `createdAt`
- `updatedAt`

`serverSeq` is the latest per-user global sequence number assigned to that document's most recent mutation. It is used for incremental pull queries such as "all documents for this user where `serverSeq > lastPulledSeq`".

#### DeviceCursor

- `id`
- `userId`
- `clientId`
- `lastServerSeq`
- `updatedAt`

#### Attachment

- `id`
- `userId`
- `documentId`
- existing storage fields

The backend authorization model becomes:

- Session authenticates one user
- Documents belong to that user
- Device cursors belong to that user

The backend should no longer query membership or workspace ownership for document sync.

## Session Model

The current session model encodes `workspaceId` into authenticated behavior. The target model should instead authenticate only the user and return a session shape that supports a single-user library.

Session behavior should answer:

- who the user is
- whether the user is authenticated
- what the sync-capable account context is

It should not answer:

- which workspace they are in
- whether they are a member of something

## Attachments

Attachment upload should remain separate from note synchronization, but note mutation caused by attachment processing must still flow through the same document sync model.

Expected behavior:

- Local note includes a pending attachment URL
- Attachment upload succeeds
- Local note content is rewritten to final attachment URL
- That rewrite becomes a normal local note mutation
- The updated note is pushed via `PushDocumentUpdate`

This prevents attachments from becoming a side channel that bypasses note convergence.

## Failure Modes

### Network unavailable

- Keep local edits fully functional
- Queue pending note pushes
- Retry sync when connectivity returns

### Auth expired

- Stop remote sync
- Preserve local pending changes
- Resume sync after re-authentication

### Corrupt local note state

- Isolate failure to the affected note
- Mark the note as error locally
- Recover via `GetDocumentSnapshot`

### Path conflict on pull

- Preserve document identity
- Resolve local filename conflict deterministically
- Do not fork backend document identity

### Crash during sync

- Local metadata and CRDT persistence should make pending work resumable
- On restart, reload pending notes and continue incremental pull from `lastServerSeq`

## User-Facing UX

The sync UX should stay intentionally small.

Expose:

- Backend URL
- Sign in / sign out
- `Sync now`
- Current sync status
- Optional last synced time

Do not expose:

- Sync interval settings
- Conflict policy settings
- Push/pull strategy toggles
- Advanced replication controls

The product goal is to behave more like a reliable built-in sync system than a configurable replication toolkit.

## Testing Strategy

### Backend unit tests

- CRDT merge for concurrent edits
- Tombstone delete behavior
- Rename/path update behavior
- Per-user authorization
- Monotonic `serverSeq` progression

### Desktop service tests

- New local file becomes a tracked note
- External markdown edit updates existing `documentId`
- Rename updates path without replacing identity
- File removal produces tombstone
- Remote pull updates local file contents and open editor state

### End-to-end sync tests

- Device A edit converges to device B
- Concurrent edits merge correctly
- Offline edit later converges after reconnect
- Attachment URL rewrite converges
- Bootstrap works for empty-server and empty-local cases
- Merge-first bootstrap works when both sides already have content

### Regression guard

At least one test should assert that the sync path does not require any workspace concept.

## Migration Guidance

This design implies a staged refactor:

1. Remove workspace/sharing concepts from the product model and auth/session model.
2. Introduce a single-user backend schema and migration path.
3. Replace revision-oriented sync APIs with the reduced CRDT-first contract.
4. Update desktop sync to use `serverSeq` instead of `acceptedRevision` and `lastSeenRevision`.
5. Keep markdown file watching and materialization, but treat both as adapters around CRDT sync.
6. Remove legacy fallback code once the new path is stable.

## Explicit Non-Goals

This refactor does not aim to provide:

- Multi-user collaboration
- Shared libraries
- Fine-grained sync settings
- Alternate sync protocols for markdown-only operation
- Long-term backward compatibility with the old workspace-based sync model inside the code

## Final Recommendation

Implement a single-user, no-share sync model where:

- CRDT state is the only network sync protocol
- Markdown files remain first-class local input and output
- Backend stores CRDT state plus derived searchable content
- Note identity is permanent and separate from file path
- Deletions are tombstoned
- Steady-state sync is incremental and cursor-based
- User-facing configuration stays minimal

This is the simplest architecture that still satisfies reliable multi-device convergence and automatic merge behavior.
