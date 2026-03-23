# Single-User Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current workspace-oriented dual sync model with a single-user, CRDT-first sync contract where local markdown files remain first-class inputs and the backend is the convergence point for one user's library across devices.

**Architecture:** The refactor removes workspace and sharing concepts, replaces revision-based document sync with a per-user `serverSeq` cursor model, keeps Yjs as the only network sync protocol, and treats the filesystem plus markdown conversion as local adapters around CRDT sync. Backend ownership becomes user-based instead of workspace-based, while desktop sync collapses to one incremental push/pull loop.

**Tech Stack:** NestJS, Prisma/Postgres, gRPC, Electron, React, Yjs, y-prosemirror, node:sqlite, chokidar

**Constraints:**
- Do not create git commits or otherwise modify git history.
- Preserve local markdown files as a supported input path.
- Preserve backend-derived markdown/plain text for search and debugging.
- Keep the app functional in a dirty worktree.

---

## File Structure

### Backend schema and generated contracts

- Modify: `packages/server-db/prisma/schema.prisma`
- Create: `packages/server-db/prisma/migrations/<timestamp>_single_user_sync_refactor/migration.sql`
- Modify: `packages/proto/slate.proto`
- Modify: `apps/desktop/electron/proto/slate.proto`
- Modify: `packages/shared/src/index.ts`

### Backend auth and ownership model

- Modify: `apps/core-backend/src/auth/auth.service.ts`
- Modify: `apps/core-backend/src/auth/auth-session.service.ts`
- Modify: `apps/core-backend/src/auth/auth.controller.ts`
- Modify: `apps/core-backend/src/app.module.ts`
- Delete or stop importing: `apps/core-backend/src/workspaces/workspaces.module.ts`
- Delete or stop importing: `apps/core-backend/src/workspaces/workspaces.controller.ts`
- Delete or stop importing: `apps/core-backend/src/workspaces/workspaces.service.ts`

### Backend document sync

- Modify: `apps/core-backend/src/documents/documents.service.ts`
- Modify: `apps/core-backend/src/documents/documents.controller.ts`
- Modify: `apps/core-backend/src/documents/documents.module.ts`
- Modify: `apps/core-backend/src/documents/crdt.service.ts`
- Modify: `apps/core-backend/src/search/search.controller.ts`
- Modify: `apps/core-backend/src/search/search.service.ts`
- Modify: `apps/core-backend/src/attachments/attachments.service.ts`
- Modify: `apps/core-backend/src/attachments/attachments.controller.ts`
- Modify: `apps/core-backend/src/common/types.ts`

### Desktop sync and local metadata

- Modify: `apps/desktop/electron/services/metadata-store.mjs`
- Modify: `apps/desktop/electron/services/backend-client.mjs`
- Modify: `apps/desktop/electron/services/sync-service.mjs`
- Modify: `apps/desktop/electron/services/workspace-service.mjs`
- Modify: `apps/desktop/electron/services/ydoc-manager.mjs`
- Modify: `apps/desktop/electron/main.mjs`
- Modify: `apps/desktop/electron/preload.mjs`
- Modify: `apps/desktop/src/lib/api.ts`
- Modify: `apps/desktop/src/lib/ydoc-context.tsx`
- Modify: `apps/desktop/src/App.tsx`

### Tests

- Modify: `apps/core-backend/test/helpers/test-app.ts`
- Modify: `apps/core-backend/test/auth.spec.ts`
- Modify: `apps/core-backend/test/grpc-auth.spec.ts`
- Modify: `apps/core-backend/test/documents.spec.ts`
- Replace: `apps/core-backend/test/isolation.spec.ts`
- Modify: `apps/core-backend/test/attachments.spec.ts`
- Modify: `apps/core-backend/src/documents/crdt.service.spec.ts`
- Modify: `apps/core-backend/src/documents/documents.service.spec.ts`
- Modify: `apps/desktop/electron/services/sync-service.test.mjs`
- Modify: `apps/desktop/electron/services/workspace-service.test.mjs`

## Task 1: Replace Workspace Contracts With Single-User Contracts

**Files:**
- Modify: `packages/proto/slate.proto`
- Modify: `apps/desktop/electron/proto/slate.proto`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/package-exports.test.ts`

- [ ] **Step 1: Write the failing shared contract assertions**

Add or update tests so they describe the new contract shape:

```ts
expectTypeOf<BackendConnectionConfig>().toMatchTypeOf<{
  authenticatedUserId?: string;
  authenticatedEmail?: string;
  authenticatedDisplayName?: string;
  authenticatedIsAdmin?: boolean;
  tokenExpiresAtUnix?: number;
}>();
```

Also add assertions that `authenticatedWorkspaceId`, `authenticatedWorkspaceName`, and `linkedWorkspaceId` are no longer exported.

- [ ] **Step 2: Run the shared test to verify it fails**

Run: `npm run test --workspace @slate/shared`

Expected: FAIL with missing or mismatched exported contract fields.

- [ ] **Step 3: Rewrite the proto definitions to the reduced sync API**

Replace the workspace-oriented messages with user-oriented sync messages:

```proto
message SessionResponse {
  string user_id = 1;
  SessionTokens tokens = 2;
  string email = 3;
  string display_name = 4;
  bool is_admin = 5;
}

message PushDocumentUpdateRequest {
  string client_id = 1;
  string document_id = 2;
  string path = 3;
  bool deleted = 4;
  bytes crdt_update = 5;
  bytes client_state_vector = 6;
}

message PushDocumentUpdateResponse {
  int64 server_seq = 1;
  bytes server_delta = 2;
  string path = 3;
  bool deleted = 4;
}

message PullDocumentEventsRequest {
  string client_id = 1;
  int64 since_server_seq = 2;
}

message DocumentEvent {
  string document_id = 1;
  string path = 2;
  bool deleted = 3;
  int64 server_seq = 4;
  bytes crdt_state = 5;
}

message PullDocumentEventsResponse {
  repeated DocumentEvent documents = 1;
  int64 latest_server_seq = 2;
}
```

Update both proto copies so Electron and backend stay aligned.

- [ ] **Step 4: Update shared TypeScript contracts**

Replace workspace-shaped frontend contracts with user-shaped contracts:

```ts
export interface LocalLibraryProfile {
  id: string;
  name: string;
  rootPath: string;
  linkedUserId?: string;
  backendEndpoint?: string;
  connected?: boolean;
}

export interface BackendConnectionConfig {
  endpoint: string;
  clientId: string;
  backendReachable: boolean;
  authStatus: BackendAuthStatus;
  authProviders: BackendAuthProvider[];
  authenticatedUserId?: string;
  authenticatedEmail?: string;
  authenticatedDisplayName?: string;
  authenticatedIsAdmin?: boolean;
  tokenExpiresAtUnix?: number;
}
```

Preserve `acceptedRevision` temporarily only where required for in-flight desktop compatibility, but remove workspace-derived fields from shared types in this task.

- [ ] **Step 5: Run the shared test to verify it passes**

Run: `npm run test --workspace @slate/shared`

Expected: PASS

## Task 2: Refactor Prisma Schema to User-Owned Documents and Device Cursors

**Files:**
- Modify: `packages/server-db/prisma/schema.prisma`
- Create: `packages/server-db/prisma/migrations/<timestamp>_single_user_sync_refactor/migration.sql`
- Modify: `apps/core-backend/test/helpers/test-app.ts`
- Test: `apps/core-backend/test/auth.spec.ts`

- [ ] **Step 1: Write the failing backend auth/setup test**

Add a test that seeds a user, logs in, and expects no workspace bootstrap to be required:

```ts
const session = await authService.loginWithPassword({
  email: "grace@example.com",
  password: "secret-pass",
  clientId: "desktop-main",
});

expect(session.userId).toBe(user.id);
expect(session).not.toHaveProperty("workspaceId");
```

- [ ] **Step 2: Run the auth test to verify it fails**

Run: `npm run test --workspace @slate/core-backend -- auth.spec.ts`

Expected: FAIL because the current auth flow still creates and returns workspace state.

- [ ] **Step 3: Replace workspace tables and columns in Prisma**

Update `schema.prisma` so ownership is user-based:

```prisma
model Document {
  id         String   @id @default(cuid())
  userId     String
  title      String
  path       String
  markdown   String   @db.Text
  plainText  String   @db.Text
  crdtState  Bytes?
  deleted    Boolean  @default(false)
  serverSeq  BigInt   @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@unique([userId, path])
  @@index([userId, serverSeq])
}

model DeviceCursor {
  id            String   @id @default(cuid())
  userId        String
  clientId      String
  lastServerSeq BigInt   @default(0)
  updatedAt     DateTime @updatedAt
  user          User     @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@unique([userId, clientId])
  @@index([userId, updatedAt])
}
```

Update `Attachment` to use `userId` instead of `workspaceId`. Remove `Workspace`, `WorkspaceMember`, and `ClientBinding`.

- [ ] **Step 4: Write the SQL migration explicitly**

Create a migration that:

- adds `userId` and `serverSeq` where needed
- backfills `Document.userId` from `ownerUserId`
- backfills `Attachment.userId` from the owning document or workspace owner
- backfills `DeviceCursor` from existing `ClientBinding`
- drops workspace tables and obsolete columns after backfill

Use SQL that is safe for existing rows before dropping old constraints.

- [ ] **Step 5: Update test database reset helpers**

Replace workspace cleanup with:

```ts
await prisma.attachment.deleteMany();
await prisma.document.deleteMany();
await prisma.deviceCursor.deleteMany();
await prisma.totpEnrollment.deleteMany();
await prisma.authIdentity.deleteMany();
await prisma.user.deleteMany();
```

- [ ] **Step 6: Run the auth test to verify schema-backed setup now passes**

Run: `npm run test --workspace @slate/core-backend -- auth.spec.ts`

Expected: PASS

## Task 3: Remove Workspace From Auth and Session Handling

**Files:**
- Modify: `apps/core-backend/src/auth/auth.service.ts`
- Modify: `apps/core-backend/src/auth/auth-session.service.ts`
- Modify: `apps/core-backend/src/auth/auth.controller.ts`
- Modify: `apps/core-backend/src/app.module.ts`
- Modify or remove: `apps/core-backend/src/workspaces/workspaces.module.ts`
- Modify or remove: `apps/core-backend/src/workspaces/workspaces.controller.ts`
- Modify or remove: `apps/core-backend/src/workspaces/workspaces.service.ts`
- Test: `apps/core-backend/test/grpc-auth.spec.ts`

- [ ] **Step 1: Write the failing gRPC session test**

Update the gRPC auth test to require a user-only session:

```ts
const currentSession = await authController.getCurrentSession({}, metadata);
expect(currentSession.userId).toBe(user.id);
expect(currentSession.email).toBe(user.email);
expect(currentSession).not.toHaveProperty("workspaceId");
expect(currentSession).not.toHaveProperty("workspaceName");
```

- [ ] **Step 2: Run the gRPC auth test to verify it fails**

Run: `npm run test --workspace @slate/core-backend -- grpc-auth.spec.ts`

Expected: FAIL because session payload and controller responses still include workspace fields.

- [ ] **Step 3: Change JWT payloads and session resolution**

Update auth token issuance to remove `workspaceId`:

```ts
private issueTokens(userId: string) {
  const payload = { sub: userId };
  const accessToken = this.jwtService.sign(payload);
  const refreshToken = this.jwtService.sign({ ...payload, kind: "refresh" }, { expiresIn: "30d" });
  return { accessToken, refreshToken };
}
```

Update `requireSession()` to load the user directly:

```ts
const user = await this.prisma.user.findUnique({
  where: { id: payload.sub },
});

return {
  userId: user.id,
  email: user.email,
  displayName: user.displayName,
  isAdmin: user.isAdmin,
};
```

- [ ] **Step 4: Remove workspace bootstrap from auth flows**

Refactor password and OIDC login/register paths to stop creating or loading workspaces. Session responses should only contain:

```ts
return {
  userId: user.id,
  tokens: this.issueTokens(user.id),
  email: user.email,
  displayName: user.displayName,
  isAdmin: user.isAdmin,
};
```

- [ ] **Step 5: Remove workspace module wiring**

Delete the `WorkspacesModule` import from `AppModule` and either remove the workspace module files or leave them unused until cleanup. Do not leave any runtime path depending on `ResolveDevSession` or `BootstrapWorkspace`.

- [ ] **Step 6: Run the gRPC auth test to verify it passes**

Run: `npm run test --workspace @slate/core-backend -- grpc-auth.spec.ts`

Expected: PASS

## Task 4: Replace Revision Sync APIs With `serverSeq` CRDT Sync APIs

**Files:**
- Modify: `apps/core-backend/src/documents/documents.service.ts`
- Modify: `apps/core-backend/src/documents/documents.controller.ts`
- Modify: `apps/core-backend/src/documents/documents.module.ts`
- Modify: `apps/core-backend/src/common/types.ts`
- Test: `apps/core-backend/test/documents.spec.ts`
- Test: `apps/core-backend/src/documents/documents.service.spec.ts`

- [ ] **Step 1: Write the failing documents service tests**

Replace revision-oriented tests with `serverSeq` behavior:

```ts
const push = await documentsService.pushDocumentUpdate(
  {
    clientId: "desktop-main",
    documentId: "note-1",
    path: "notes/indexing.md",
    deleted: false,
    crdtUpdate,
    clientStateVector,
  },
  { userId: user.id },
);

expect(push.serverSeq).toBe(1);

const pulled = await documentsService.pullDocumentEvents(
  {
    clientId: "desktop-main",
    sinceServerSeq: 0,
  },
  { userId: user.id },
);

expect(pulled.documents).toHaveLength(1);
expect(pulled.latestServerSeq).toBe(1);
```

Add a delete tombstone test and a "pull only this user's docs" test to replace workspace isolation coverage.

- [ ] **Step 2: Run the documents tests to verify they fail**

Run: `npm run test --workspace @slate/core-backend -- documents.spec.ts`

Expected: FAIL because the current service exposes `upsert`, `pull`, and revision conflicts instead of the new API.

- [ ] **Step 3: Replace the public document service API**

Implement the new service shape:

```ts
async pushDocumentUpdate(
  payload: {
    clientId: string;
    documentId: string;
    path: string;
    deleted: boolean;
    crdtUpdate: Buffer | Uint8Array;
    clientStateVector?: Buffer | Uint8Array;
  },
  principal: { userId: string },
) { /* merge CRDT, derive markdown, persist serverSeq */ }

async pullDocumentEvents(
  payload: { clientId: string; sinceServerSeq: string | number },
  principal: { userId: string },
) { /* return docs where serverSeq > sinceServerSeq */ }

async getDocumentSnapshot(
  payload: { documentId: string },
  principal: { userId: string },
) { /* return full CRDT state for one doc */ }
```

Remove stale-revision conflict handling entirely from the sync path.

- [ ] **Step 4: Make `serverSeq` a per-user global sequence**

Implement a single monotonic sequence for a user's document mutations. The simplest acceptable first pass is:

```ts
const last = await this.prisma.document.findFirst({
  where: { userId: principal.userId },
  orderBy: { serverSeq: "desc" },
  select: { serverSeq: true },
});

const nextServerSeq = (last?.serverSeq ?? BigInt(0)) + BigInt(1);
```

Use a transaction so concurrent pushes do not reuse the same sequence.

- [ ] **Step 5: Update gRPC controller methods**

Replace:

- `UpsertDocument`
- `DeleteDocument`
- `PullChanges`
- `SyncDocument`
- `BootstrapDocument`

With:

- `PushDocumentUpdate`
- `PullDocumentEvents`
- `GetDocumentSnapshot`

The controller should derive user identity from metadata and should not accept user ownership from client payloads.

- [ ] **Step 6: Run documents service tests to verify they pass**

Run: `npm run test --workspace @slate/core-backend -- documents.spec.ts`

Expected: PASS

## Task 5: Update Search, Attachments, and Remaining Backend Callers to User Ownership

**Files:**
- Modify: `apps/core-backend/src/search/search.controller.ts`
- Modify: `apps/core-backend/src/search/search.service.ts`
- Modify: `apps/core-backend/src/attachments/attachments.service.ts`
- Modify: `apps/core-backend/src/attachments/attachments.controller.ts`
- Modify: `apps/core-backend/test/attachments.spec.ts`
- Replace: `apps/core-backend/test/isolation.spec.ts`

- [ ] **Step 1: Write the failing attachment and isolation tests**

Replace workspace assumptions with user ownership:

```ts
const results = await searchController.searchDocuments(
  { query: "Secured", limit: 5 },
  metadata,
);

expect(results.results).toHaveLength(1);
```

And replace `Workspace isolation` with `User isolation`:

```ts
expect(pullA.documents).toHaveLength(1);
expect(pullA.documents[0]?.documentId ?? pullA.documents[0]?.id).toBe("a-note");
```

- [ ] **Step 2: Run the targeted backend tests to verify they fail**

Run: `npm run test --workspace @slate/core-backend -- grpc-auth.spec.ts isolation.spec.ts attachments.spec.ts`

Expected: FAIL because controllers and services still require `workspaceId`.

- [ ] **Step 3: Refactor search and attachment APIs**

Search controller should derive `userId` from the session and ignore any workspace passed by the client:

```ts
return this.searchService.search(principal.userId, payload.query, payload.limit ?? 20);
```

Attachment registration and upload should store `userId` and validate that the target document belongs to the authenticated user.

- [ ] **Step 4: Delete or rename the workspace isolation test**

Replace the old isolation test with a new user-isolation test that asserts one user cannot pull or search another user's documents on the shared backend.

- [ ] **Step 5: Run the targeted backend tests to verify they pass**

Run: `npm run test --workspace @slate/core-backend -- grpc-auth.spec.ts isolation.spec.ts attachments.spec.ts`

Expected: PASS

## Task 6: Replace Desktop Revision Metadata With `serverSeq` and User-Only State

**Files:**
- Modify: `apps/desktop/electron/services/metadata-store.mjs`
- Modify: `apps/desktop/src/lib/api.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `apps/desktop/electron/services/workspace-service.test.mjs`

- [ ] **Step 1: Write the failing desktop metadata test**

Add or update a test that expects:

```js
metadataStore.setSetting("lastServerSeq", 7);
assert.equal(metadataStore.getSetting("lastServerSeq", 0), 7);
```

And verify note rows can track `server_seq` instead of `accepted_revision`.

- [ ] **Step 2: Run the desktop workspace-service test to verify it fails**

Run: `npm run test --workspace @slate/desktop`

Expected: FAIL because local metadata and service methods still rely on revision-era fields and workspace-shaped profile data.

- [ ] **Step 3: Migrate the local metadata store**

Change note metadata and settings to this shape:

```sql
ALTER TABLE notes ADD COLUMN server_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notes ADD COLUMN remote_deleted INTEGER NOT NULL DEFAULT 0;
```

Then update code paths to use:

- `lastServerSeq` instead of `lastSeenRevision`
- `server_seq` instead of `accepted_revision`
- user-linked settings without workspace fields

Keep backward-compatible reads during the migration, for example:

```js
acceptedRevision: row.server_seq ?? row.accepted_revision ?? 0
```

Use this only as a transitional read path; write the new field names everywhere in the updated code.

- [ ] **Step 4: Update frontend/shared API types**

Rename the local profile type and remove workspace-linked fields from the browser and desktop API layers.

- [ ] **Step 5: Run the desktop test to verify it passes**

Run: `npm run test --workspace @slate/desktop`

Expected: PASS

## Task 7: Refactor Desktop Sync To Incremental CRDT Push/Pull

**Files:**
- Modify: `apps/desktop/electron/services/backend-client.mjs`
- Modify: `apps/desktop/electron/services/sync-service.mjs`
- Modify: `apps/desktop/electron/services/workspace-service.mjs`
- Modify: `apps/desktop/electron/services/ydoc-manager.mjs`
- Modify: `apps/desktop/electron/main.mjs`
- Modify: `apps/desktop/electron/preload.mjs`
- Modify: `apps/desktop/src/lib/ydoc-context.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/electron/services/sync-service.test.mjs`

- [ ] **Step 1: Write the failing sync-service tests**

Replace revision-based expectations with `PushDocumentUpdate`/`PullDocumentEvents` expectations:

```js
await syncService.syncNow();

assert.deepEqual(calls.pushes[0], {
  clientId: "client-1",
  documentId: "note-1",
  path: "note-1.md",
  deleted: false,
});

assert.equal(metadataStore.settings.get("lastServerSeq"), 4);
```

Add coverage for:

- tombstone push on local delete
- remote pull creating a missing local file
- remote pull moving an existing local file
- external markdown edit re-bootstrap marking a note pending for push

- [ ] **Step 2: Run the desktop sync tests to verify they fail**

Run: `npm run test --workspace @slate/desktop`

Expected: FAIL because the current sync loop still calls `PullChanges`, `SyncDocument`, and revision-based delete logic.

- [ ] **Step 3: Replace backend-client RPC methods**

Delete the old document client wrappers and add:

```js
async pushDocumentUpdate(payload) {
  return this.unary(this.documentClient(), "PushDocumentUpdate", payload, this.currentAuthMetadata());
}

async pullDocumentEvents(payload) {
  return this.unary(this.documentClient(), "PullDocumentEvents", payload, this.currentAuthMetadata());
}

async getDocumentSnapshot(payload) {
  return this.unary(this.documentClient(), "GetDocumentSnapshot", payload, this.currentAuthMetadata());
}
```

- [ ] **Step 4: Rewrite `sync-service` around pending pushes and `lastServerSeq`**

Core loop target:

```js
await this.pushPendingNotes(clientId);
await this.pullRemoteEvents(clientId);
await this.syncPendingAttachments();
if (this.metadataStore.listDirtyNotes().length > 0) {
  await this.pushPendingNotes(clientId);
}
```

Delete or fully retire:

- `knownServerRevision`
- `lastSeenRevision`
- `fullSync()` behavior that pushes all notes then pulls from `0`
- revision conflict retry logic

Keep:

- offline queueing
- auth recovery
- sync status events
- manual `syncNow`

- [ ] **Step 5: Keep markdown as first-class local input**

Update `workspace-service` so external file changes still:

- read changed markdown
- rebuild CRDT state for the same `documentId`
- mark the note dirty
- notify the renderer with the latest local state

Update remote pull handling so incoming remote events can:

- create local files
- move existing files
- delete local files for tombstones

- [ ] **Step 6: Run the desktop sync tests to verify they pass**

Run: `npm run test --workspace @slate/desktop`

Expected: PASS

## Task 8: Remove Dead Workspace/Revision Code and Run Full Verification

**Files:**
- Modify: `apps/core-backend/src/app.module.ts`
- Modify: `apps/core-backend/src/main.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/lib/api.ts`
- Modify: `README.md`
- Search: `apps/`, `packages/`

- [ ] **Step 1: Write or update the final regression tests**

Add one explicit assertion that the sync path no longer depends on workspace concepts:

```ts
expect(serializedSession).not.toContain("workspace");
expect(documentPayload).not.toHaveProperty("workspaceId");
```

- [ ] **Step 2: Remove leftover workspace and revision references**

Search for and delete or refactor remaining references:

Run: `rg -n "workspaceId|workspaceName|linkedWorkspaceId|acceptedRevision|lastSeenRevision|knownServerRevision|PullChanges|SyncDocument|UpsertDocument|BootstrapWorkspace|ResolveDevSession" apps packages`

Expected after cleanup: only historical comments or migration-compat code remain, and those should be intentionally documented.

- [ ] **Step 3: Run focused backend verification**

Run: `npm run test --workspace @slate/core-backend -- auth.spec.ts grpc-auth.spec.ts documents.spec.ts isolation.spec.ts attachments.spec.ts`

Expected: PASS

- [ ] **Step 4: Run desktop verification**

Run: `npm run test --workspace @slate/desktop`

Expected: PASS

- [ ] **Step 5: Run backend typecheck/lint**

Run: `npm run lint --workspace @slate/core-backend`

Expected: PASS

- [ ] **Step 6: Run desktop typecheck/lint**

Run: `npm run lint --workspace @slate/desktop`

Expected: PASS

## Plan Review

### Local Review

Status: Approved

Blocking issues:
- None

Advisory notes:
- Decide during implementation whether `PullDocumentEvents` should always return full CRDT state or cap response size and force `GetDocumentSnapshot` for oversized payloads.
- Decide during implementation whether path normalization is cross-platform canonical or platform-specific with server-stored normalized comparison keys.

## Execution Note

This plan assumes a staged refactor inside the current workspace and explicitly does not include git commit steps because the user requested no git writes. Execute tasks in order. Do not try to preserve both sync models indefinitely; remove revision/workspace behavior as soon as the replacement path is verified.
