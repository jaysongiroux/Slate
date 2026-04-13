# Phase 2: Desktop Refactor + gRPC Removal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop app's gRPC-based sync with HTTP REST + SSE. Remove all filesystem markdown read/write. Replace `workspace-service`, `sync-service`, `backend-client`, and related files with `note-store` + `http-client`. Remove gRPC from the backend entirely. **Requires Phase 1 to be deployed first.**

**Architecture:** The SQLite `notes` table (via `MetadataStore`) becomes the offline note registry — no markdown on disk. Content lives in IndexedDB (y-indexeddb) via Hocuspocus. `http-client.mjs` replaces `backend-client.mjs` using native `fetch`. `note-store.mjs` replaces `workspace-service.mjs` for note metadata. `main.mjs` initialization and all IPC handlers are rewritten. gRPC is removed from both ends.

**Tech Stack:** Electron (Node.js main process), `node:sqlite` (built-in), native `fetch` (Node 18+), Fastify (backend gRPC removal), Jest / `node --test`.

> **Known gap:** `http-client.mjs` includes a 401 auto-refresh stub (`_refreshIfNeeded`) but full token-refresh retry on every authenticated call is left as a follow-up. The `refreshTokens()` method is implemented and `get/post/patch/put/delete` should call it on 401 before retrying — add this in Task 3 Step 3 (or as a follow-up task after the core refactor is verified working).

---

## File Map

**Desktop — Delete:**

- `apps/desktop/electron/services/workspace-service.mjs`
- `apps/desktop/electron/services/sync-service.mjs`
- `apps/desktop/electron/services/sync-service.test.mjs`
- `apps/desktop/electron/services/ydoc-manager.mjs`
- `apps/desktop/electron/services/backend-client.mjs`
- `apps/desktop/electron/services/workspace-disk-reconcile.mjs`
- `apps/desktop/electron/services/note-crdt-state.mjs`
- `apps/desktop/electron/services/sync-logger.mjs`
- `apps/desktop/electron/services/file-watcher.mjs`
- `apps/desktop/electron/services/file-watcher.test.mjs`
- `apps/desktop/electron/services/disk-content-hash.mjs`
- `apps/desktop/electron/services/sync-intervals.mjs` (if exists)

**Desktop — Create:**

- `apps/desktop/electron/services/note-store.mjs`
- `apps/desktop/electron/services/note-store.test.mjs`
- `apps/desktop/electron/services/http-client.mjs`
- `apps/desktop/electron/services/http-client.test.mjs`

**Desktop — Modify:**

- `apps/desktop/electron/services/metadata-store.mjs` (schema migration)
- `apps/desktop/electron/main.mjs` (full rewrite)
- `apps/desktop/electron/preload.mjs` (update IPC bridge)
- `apps/desktop/src/lib/api.ts` (update types)

**Shared — Modify:**

- `packages/shared/src/index.ts` (update `LocalNoteSummary`, `DesktopSnapshot`)

**Desktop renderer — Modify:**

- `apps/desktop/src/App.tsx` (remove markdown persistence, add plain_text update)

**Backend — Modify:**

- `apps/core-backend/src/main.ts` (remove gRPC)
- `apps/core-backend/src/app.module.ts` (remove microservice imports if any)
- `apps/core-backend/package.json` (remove gRPC deps)

---

### Task 1: Migrate MetadataStore Schema

The existing `notes` table has columns for CRDT state, sync state, disk hashes, etc. Add the new columns needed and keep existing ones (migrations are additive — do NOT drop columns until they are fully unused).

**Files:**

- Modify: `apps/desktop/electron/services/metadata-store.mjs`

- [ ] **Step 1: Add new columns to the `migrate()` method**

In `apps/desktop/electron/services/metadata-store.mjs`, add these migration steps at the END of the `migrate()` method (after the existing `try/catch` blocks):

```javascript
// New columns for database-first model
try {
  this.db.exec("ALTER TABLE notes ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0");
} catch {}
try {
  this.db.exec("ALTER TABLE notes ADD COLUMN plain_text TEXT NOT NULL DEFAULT ''");
} catch {}
try {
  this.db.exec("ALTER TABLE notes ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))");
} catch {}
```

Also add these new methods to the `MetadataStore` class:

```javascript
setIsTemplate(noteId, isTemplate) {
  this.db.prepare("UPDATE notes SET is_template = ? WHERE id = ?").run(isTemplate ? 1 : 0, noteId);
}

updatePlainText(noteId, plainText) {
  this.db
    .prepare("UPDATE notes SET plain_text = ?, updated_at = ? WHERE id = ?")
    .run(plainText ?? "", new Date().toISOString(), noteId);
}

listTemplates() {
  return this.db.prepare("SELECT * FROM notes WHERE is_template = 1 AND deleted = 0 ORDER BY updated_at DESC").all();
}

searchNotesByTitle(query) {
  const like = `%${query.replace(/[%_]/g, "\\$&")}%`;
  return this.db
    .prepare("SELECT * FROM notes WHERE deleted = 0 AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 50")
    .all(like);
}
```

- [ ] **Step 2: Restart the app (dev) to verify migration runs without error**

```bash
cd apps/desktop && npm run dev 2>&1 | head -20
```

Expected: App launches, no SQLite errors in console.

- [ ] **Step 3: Commit**

```bash
cd apps/desktop && git add electron/services/metadata-store.mjs
git commit -m "feat(desktop): add is_template, plain_text, created_at columns to notes table"
```

---

### Task 2: Create note-store.mjs

`NoteStore` wraps `MetadataStore` for note-specific CRUD. It generates IDs using `crypto.randomUUID()`, handles virtual paths (no filesystem), and derives folder names from path prefixes.

**Files:**

- Create: `apps/desktop/electron/services/note-store.mjs`
- Create: `apps/desktop/electron/services/note-store.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/electron/services/note-store.test.mjs`:

```javascript
import { strict as assert } from "node:assert";
import { test, before, after } from "node:test";
import { DatabaseSync } from "node:sqlite";

// Inline MetadataStore-like minimal DB for tests
function makeTestStore() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      relative_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      is_template INTEGER NOT NULL DEFAULT 0,
      plain_text TEXT NOT NULL DEFAULT '',
      deleted INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return {
    db,
    getNoteById: (id) => db.prepare("SELECT * FROM notes WHERE id = ?").get(id),
    getNoteByPath: (path) => db.prepare("SELECT * FROM notes WHERE relative_path = ?").get(path),
    listNotes: () =>
      db.prepare("SELECT * FROM notes WHERE deleted = 0 ORDER BY updated_at DESC").all(),
    listTemplates: () =>
      db.prepare("SELECT * FROM notes WHERE is_template = 1 AND deleted = 0").all(),
    isPathAvailable: (path) =>
      !db.prepare("SELECT 1 FROM notes WHERE relative_path = ? AND deleted = 0").get(path),
    setPinned: (id, val) =>
      db.prepare("UPDATE notes SET pinned = ? WHERE id = ?").run(val ? 1 : 0, id),
    updatePlainText: (id, text) =>
      db.prepare("UPDATE notes SET plain_text = ? WHERE id = ?").run(text, id),
    upsertNote(note) {
      db.prepare(
        `
        INSERT INTO notes(id, relative_path, title, is_template, deleted, pinned, updated_at, created_at)
        VALUES (@id, @relativePath, @title, @isTemplate, @deleted, @pinned, @updatedAt, @createdAt)
        ON CONFLICT(id) DO UPDATE SET
          relative_path = excluded.relative_path,
          title = excluded.title,
          is_template = excluded.is_template,
          deleted = excluded.deleted,
          pinned = excluded.pinned,
          updated_at = excluded.updated_at
      `,
      ).run({
        id: note.id,
        relativePath: note.path ?? note.relativePath,
        title: note.title,
        isTemplate: note.isTemplate ? 1 : 0,
        deleted: note.deleted ? 1 : 0,
        pinned: note.pinned ? 1 : 0,
        updatedAt: note.updatedAt ?? new Date().toISOString(),
        createdAt: note.createdAt ?? new Date().toISOString(),
      });
    },
    markDeleted: (path) =>
      db
        .prepare("UPDATE notes SET deleted = 1, updated_at = ? WHERE relative_path = ?")
        .run(new Date().toISOString(), path),
  };
}

// Dynamically import so we can replace MetadataStore
const { NoteStore } = await import("./note-store.mjs");

test("createNote: creates a note with unique ID and path", async () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const note = noteStore.createNote({ parentPath: "" });
  assert.ok(note.id, "should have id");
  assert.ok(note.path.startsWith("untitled"), "path should start with untitled");
  assert.equal(note.title, "Untitled");
  assert.equal(note.deleted, false);
});

test("createNote: uses parent path as prefix", async () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const note = noteStore.createNote({ parentPath: "projects" });
  assert.ok(note.path.startsWith("projects/"), "path should have projects/ prefix");
});

test("createNote: avoids duplicate paths", async () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const a = noteStore.createNote({ parentPath: "" });
  const b = noteStore.createNote({ parentPath: "" });
  assert.notEqual(a.path, b.path, "paths should be unique");
});

test("listNotes: returns non-deleted notes as LocalNoteSummary", async () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  noteStore.createNote({ parentPath: "" });
  const notes = noteStore.listNotes();
  assert.equal(notes.length, 1);
  assert.ok("id" in notes[0] && "title" in notes[0] && "path" in notes[0]);
});

test("deleteNote: marks note as deleted", async () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const note = noteStore.createNote({ parentPath: "" });
  noteStore.deleteNote(note.id);
  const after = noteStore.listNotes();
  assert.equal(after.length, 0, "deleted note should not appear in list");
});

test("moveNote: updates path", async () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const note = noteStore.createNote({ parentPath: "" });
  const moved = noteStore.moveNote(note.id, "archive");
  assert.ok(moved.path.startsWith("archive/"), "path should start with archive/");
});

test("renameNote: updates title and path slug", async () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  const note = noteStore.createNote({ parentPath: "" });
  const renamed = noteStore.renameNote(note.id, "My Design Doc");
  assert.equal(renamed.title, "My Design Doc");
  assert.ok(renamed.path.includes("my-design-doc"), "path slug should match title");
});

test("listFolders: derives folders from note paths", async () => {
  const store = makeTestStore();
  const noteStore = new NoteStore({ metadataStore: store });
  noteStore.createNote({ parentPath: "projects" });
  noteStore.createNote({ parentPath: "projects/backend" });
  noteStore.createNote({ parentPath: "" });
  const folders = noteStore.listFolders();
  assert.ok(folders.includes("projects"), "should include projects");
  assert.ok(folders.includes("projects/backend"), "should include nested folder");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/desktop && node --test electron/services/note-store.test.mjs 2>&1 | head -20
```

Expected: FAIL with "Cannot find module './note-store.mjs'"

- [ ] **Step 3: Create note-store.mjs**

Create `apps/desktop/electron/services/note-store.mjs`:

```javascript
import crypto from "node:crypto";

function slugify(str) {
  return (
    str
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "untitled"
  );
}

function buildSummary(row) {
  return {
    id: row.id,
    title: row.title,
    path: row.relative_path,
    pinned: row.pinned === 1,
    isTemplate: row.is_template === 1,
    deleted: row.deleted === 1,
    updatedAt: row.updated_at,
    createdAt: row.created_at ?? row.updated_at,
  };
}

export class NoteStore {
  constructor({ metadataStore }) {
    this._db = metadataStore;
  }

  /** Ensure a path is not already in use; appends -1, -2, etc. if needed. */
  _uniquePath(basePath, excludeId = null) {
    let candidate = basePath;
    let counter = 1;
    while (true) {
      const existing = this._db.getNoteByPath(candidate);
      if (!existing || existing.id === excludeId) return candidate;
      candidate = `${basePath}-${counter++}`;
    }
  }

  createNote({ parentPath = "" } = {}) {
    const id = crypto.randomUUID();
    const base = parentPath ? `${parentPath}/untitled` : "untitled";
    const path = this._uniquePath(base);
    const now = new Date().toISOString();
    this._db.upsertNote({
      id,
      path,
      title: "Untitled",
      isTemplate: false,
      deleted: false,
      pinned: false,
      updatedAt: now,
      createdAt: now,
    });
    return buildSummary(this._db.getNoteById(id));
  }

  createDailyNote() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const title = `${yyyy}-${mm}-${dd}`;
    const base = `daily/${title}`;
    const existing = this._db.getNoteByPath(base);
    if (existing) return buildSummary(existing);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this._db.upsertNote({
      id,
      path: base,
      title,
      isTemplate: false,
      deleted: false,
      pinned: false,
      updatedAt: now,
      createdAt: now,
    });
    return buildSummary(this._db.getNoteById(id));
  }

  createTemplate({ parentPath = "" } = {}) {
    const id = crypto.randomUUID();
    const base = parentPath ? `${parentPath}/untitled-template` : "templates/untitled-template";
    const path = this._uniquePath(base);
    const now = new Date().toISOString();
    this._db.upsertNote({
      id,
      path,
      title: "Untitled Template",
      isTemplate: true,
      deleted: false,
      pinned: false,
      updatedAt: now,
      createdAt: now,
    });
    return buildSummary(this._db.getNoteById(id));
  }

  createFolder(parentPath = "") {
    // Folders are implicit from note paths; nothing to do in DB
    return parentPath ? `${parentPath}/new-folder` : "new-folder";
  }

  getNoteById(id) {
    const row = this._db.getNoteById(id);
    if (!row) return null;
    return buildSummary(row);
  }

  listNotes() {
    return this._db.listNotes().map(buildSummary);
  }

  listTemplates() {
    return this._db.listTemplates().map(buildSummary);
  }

  listFolders() {
    const notes = this._db.listNotes();
    const folders = new Set();
    for (const note of notes) {
      const parts = note.relative_path.split("/");
      for (let i = 1; i < parts.length; i++) {
        folders.add(parts.slice(0, i).join("/"));
      }
    }
    return [...folders].sort();
  }

  deleteNote(noteId) {
    const row = this._db.getNoteById(noteId);
    if (!row) return;
    this._db.markDeleted(row.relative_path);
  }

  togglePinNote(noteId, pinned) {
    this._db.setPinned(noteId, pinned);
  }

  moveNote(noteId, targetFolderPath) {
    const row = this._db.getNoteById(noteId);
    if (!row) throw new Error(`Note ${noteId} not found`);
    const slug = slugify(row.title);
    const base = targetFolderPath ? `${targetFolderPath}/${slug}` : slug;
    const newPath = this._uniquePath(base, noteId);
    this._db.upsertNote({
      id: noteId,
      path: newPath,
      title: row.title,
      isTemplate: row.is_template === 1,
      deleted: false,
      pinned: row.pinned === 1,
      updatedAt: new Date().toISOString(),
      createdAt: row.created_at ?? row.updated_at,
    });
    return buildSummary(this._db.getNoteById(noteId));
  }

  renameNote(noteId, newTitle) {
    const row = this._db.getNoteById(noteId);
    if (!row) throw new Error(`Note ${noteId} not found`);
    const parts = row.relative_path.split("/");
    parts[parts.length - 1] = slugify(newTitle);
    const base = parts.join("/");
    const newPath = this._uniquePath(base, noteId);
    this._db.upsertNote({
      id: noteId,
      path: newPath,
      title: newTitle,
      isTemplate: row.is_template === 1,
      deleted: false,
      pinned: row.pinned === 1,
      updatedAt: new Date().toISOString(),
      createdAt: row.created_at ?? row.updated_at,
    });
    return buildSummary(this._db.getNoteById(noteId));
  }

  renameFolder(folderPath, newName) {
    const notes = this._db.listNotesByPrefix(folderPath);
    const parentParts = folderPath.split("/");
    parentParts[parentParts.length - 1] = slugify(newName);
    const newFolderPath = parentParts.join("/");
    for (const note of notes) {
      const newPath = note.relative_path.replace(folderPath, newFolderPath);
      const unique = this._uniquePath(newPath, note.id);
      this._db.upsertNote({
        id: note.id,
        path: unique,
        title: note.title,
        isTemplate: note.is_template === 1,
        deleted: false,
        pinned: note.pinned === 1,
        updatedAt: new Date().toISOString(),
        createdAt: note.created_at ?? note.updated_at,
      });
    }
  }

  moveFolder(folderPath, targetParentPath) {
    const notes = this._db.listNotesByPrefix(folderPath);
    const folderName = folderPath.split("/").pop();
    const newFolderBase = targetParentPath ? `${targetParentPath}/${folderName}` : folderName;
    for (const note of notes) {
      const newPath = note.relative_path.replace(folderPath, newFolderBase);
      const unique = this._uniquePath(newPath, note.id);
      this._db.upsertNote({
        id: note.id,
        path: unique,
        title: note.title,
        isTemplate: note.is_template === 1,
        deleted: false,
        pinned: note.pinned === 1,
        updatedAt: new Date().toISOString(),
        createdAt: note.created_at ?? note.updated_at,
      });
    }
  }

  deleteFolder(folderPath) {
    const notes = this._db.listNotesByPrefix(folderPath);
    for (const note of notes) {
      this._db.markDeleted(note.relative_path);
    }
  }

  updatePlainText(noteId, plainText) {
    this._db.updatePlainText(noteId, plainText);
  }

  upsertFromImport({ id, path, title, isTemplate = false }) {
    const uniquePath = this._uniquePath(path);
    const now = new Date().toISOString();
    this._db.upsertNote({
      id,
      path: uniquePath,
      title,
      isTemplate,
      deleted: false,
      pinned: false,
      updatedAt: now,
      createdAt: now,
    });
    return buildSummary(this._db.getNoteById(id));
  }

  getSnapshot() {
    return {
      notes: this.listNotes(),
      folders: this.listFolders(),
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/desktop && node --test electron/services/note-store.test.mjs 2>&1
```

Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
cd apps/desktop && git add electron/services/note-store.mjs electron/services/note-store.test.mjs
git commit -m "feat(desktop): add note-store.mjs replacing workspace-service for metadata CRUD"
```

---

### Task 3: Create http-client.mjs

Replaces `backend-client.mjs`. Pure `fetch`-based REST client. Handles auth, notes sync, AI chat (SSE), calendar, and attachments.

**Files:**

- Create: `apps/desktop/electron/services/http-client.mjs`
- Create: `apps/desktop/electron/services/http-client.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/electron/services/http-client.test.mjs`:

```javascript
import { strict as assert } from "node:assert";
import { test, mock } from "node:test";
import { HttpClient } from "./http-client.mjs";

function makeStore(settings = {}) {
  const data = {
    backendEndpoint: "localhost:4000",
    accessToken: "test-token",
    refreshToken: "refresh-token",
    ...settings,
  };
  return {
    getSetting: (key, fallback = null) => data[key] ?? fallback,
    setSetting: (key, value) => {
      data[key] = value;
    },
  };
}

function makeMockResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

test("checkConnection: returns true when health endpoint returns ok", async (t) => {
  const mockFetch = t.mock.fn(async () => makeMockResponse('{"ok":true}'));
  global.fetch = mockFetch;
  const client = new HttpClient({ metadataStore: makeStore() });
  const result = await client.checkConnection("localhost:4000");
  assert.equal(result, true);
  const url = mockFetch.mock.calls[0].arguments[0];
  assert.ok(url.includes("/api/health"), "should call health endpoint");
});

test("get: attaches Bearer token from metadata store", async (t) => {
  const mockFetch = t.mock.fn(async () => makeMockResponse('{"providers":[]}'));
  global.fetch = mockFetch;
  const client = new HttpClient({ metadataStore: makeStore() });
  await client.get("/api/auth/providers");
  const init = mockFetch.mock.calls[0].arguments[1];
  assert.equal(init.headers["Authorization"], "Bearer test-token");
});

test("post: sends JSON body", async (t) => {
  const mockFetch = t.mock.fn(async () => makeMockResponse('{"id":"c1"}'));
  global.fetch = mockFetch;
  const client = new HttpClient({ metadataStore: makeStore() });
  await client.post("/api/ai/conversations", {});
  const init = mockFetch.mock.calls[0].arguments[1];
  assert.equal(init.method, "POST");
  assert.equal(init.headers["Content-Type"], "application/json");
});

test("baseUrl: normalizes endpoint to http URL", () => {
  const client = new HttpClient({
    metadataStore: makeStore({ backendEndpoint: "myserver.local:4000" }),
  });
  assert.equal(client.baseUrl(), "http://myserver.local:4000");
});

test("baseUrl: converts legacy gRPC port :50051 to :4000", () => {
  const client = new HttpClient({
    metadataStore: makeStore({ backendEndpoint: "localhost:50051" }),
  });
  assert.equal(client.baseUrl(), "http://localhost:4000");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/desktop && node --test electron/services/http-client.test.mjs 2>&1 | head -20
```

Expected: FAIL with "Cannot find module './http-client.mjs'"

- [ ] **Step 3: Create http-client.mjs**

Create `apps/desktop/electron/services/http-client.mjs`:

```javascript
export class HttpClient {
  constructor({ metadataStore }) {
    this._store = metadataStore;
    this._activeChatAbort = null;
  }

  /** Normalize stored endpoint to an http:// base URL. */
  baseUrl(endpoint = null) {
    const raw = endpoint ?? this._store.getSetting("backendEndpoint", "");
    if (!raw) return null;
    // Convert legacy gRPC port to HTTP port
    const normalized = raw.replace(/:50051$/, ":4000");
    if (normalized.startsWith("http://") || normalized.startsWith("https://")) return normalized;
    return `http://${normalized}`;
  }

  _token() {
    return this._store.getSetting("accessToken", null);
  }

  _headers(extra = {}) {
    const token = this._token();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    };
  }

  async checkConnection(endpoint) {
    const base = this.baseUrl(endpoint);
    if (!base) return false;
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async get(path) {
    const base = this.baseUrl();
    const response = await fetch(`${base}${path}`, {
      headers: this._headers({ "Content-Type": undefined }),
    });
    if (!response.ok) throw new Error(`GET ${path} failed: ${response.status}`);
    return response.json();
  }

  async post(path, body) {
    const base = this.baseUrl();
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`POST ${path} failed (${response.status}): ${text}`);
    }
    return response.json();
  }

  async patch(path, body) {
    const base = this.baseUrl();
    const response = await fetch(`${base}${path}`, {
      method: "PATCH",
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`PATCH ${path} failed (${response.status}): ${text}`);
    }
    return response.json();
  }

  async put(path, body) {
    const base = this.baseUrl();
    const response = await fetch(`${base}${path}`, {
      method: "PUT",
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`PUT ${path} failed (${response.status}): ${text}`);
    }
    return response.json();
  }

  async delete(path) {
    const base = this.baseUrl();
    const response = await fetch(`${base}${path}`, {
      method: "DELETE",
      headers: this._headers({ "Content-Type": undefined }),
    });
    if (!response.ok) throw new Error(`DELETE ${path} failed: ${response.status}`);
    return response.json();
  }

  // ── Auth ──

  async listAuthProviders(endpoint) {
    const base = this.baseUrl(endpoint);
    const response = await fetch(`${base}/api/auth/providers`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Cannot reach backend");
    return response.json();
  }

  async loginWithPassword(endpoint, { email, password, totpCode, clientId }) {
    const base = this.baseUrl(endpoint);
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, totpCode, clientId }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.message ?? "Login failed");
    }
    return response.json();
  }

  async startOidc(endpoint, { providerId, redirectUri, clientId }) {
    const base = this.baseUrl(endpoint);
    const response = await fetch(`${base}/api/auth/oidc/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId, redirectUri, clientId }),
    });
    if (!response.ok) throw new Error("Failed to start OIDC");
    return response.json();
  }

  async completeOidc(endpoint, { providerId, redirectUri, state, code, clientId }) {
    const base = this.baseUrl(endpoint);
    const response = await fetch(`${base}/api/auth/oidc/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId, redirectUri, state, code, clientId }),
    });
    if (!response.ok) throw new Error("Failed to complete OIDC");
    return response.json();
  }

  async refreshTokens(endpoint, refreshToken) {
    const base = this.baseUrl(endpoint);
    const response = await fetch(`${base}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) throw new Error("Token refresh failed");
    return response.json();
  }

  // ── Notes ──

  async listNotesRemote() {
    return this.get("/api/notes");
  }

  async createNoteRemote({ id, path, title }) {
    return this.post("/api/notes", { id, path, title });
  }

  async updateNoteRemote(id, updates) {
    return this.patch(`/api/notes/${id}`, updates);
  }

  async deleteNoteRemote(id) {
    return this.delete(`/api/notes/${id}`);
  }

  async syncNotesSince(since) {
    const q = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.get(`/api/notes/sync${q}`);
  }

  async importNotesRemote(notes) {
    return this.post("/api/notes/import", { notes });
  }

  // ── AI Chat ──

  async getAiConfig() {
    return this.get("/api/ai/config");
  }

  async updateAiConfig(config) {
    return this.put("/api/ai/config", config);
  }

  async createConversation() {
    return this.post("/api/ai/conversations", {});
  }

  async listConversations() {
    const data = await this.get("/api/ai/conversations");
    return data.conversations ?? data;
  }

  async deleteConversation(id) {
    return this.delete(`/api/ai/conversations/${id}`);
  }

  async getConversationMessages(conversationId) {
    const data = await this.get(`/api/ai/conversations/${conversationId}/messages`);
    return data.messages ?? data;
  }

  async triggerEmbedding() {
    return this.post("/api/ai/embed", {});
  }

  isStreamingChat() {
    return this._activeChatAbort !== null;
  }

  cancelChatStream() {
    this._activeChatAbort?.abort();
    this._activeChatAbort = null;
  }

  async streamSendMessage(
    { conversationId, content, enabledCalendarIds = [], enabledIcsIds = [], timezone = "" },
    onEvent,
  ) {
    const abort = new AbortController();
    this._activeChatAbort = abort;

    try {
      const base = this.baseUrl();
      const response = await fetch(`${base}/api/ai/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({ content, enabledCalendarIds, enabledIcsIds, timezone }),
        signal: abort.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "Request failed");
        onEvent({ type: "error", content: text });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            for (const line of part.split("\n")) {
              if (line.startsWith("data: ")) {
                try {
                  onEvent(JSON.parse(line.slice(6)));
                } catch {
                  // ignore malformed SSE line
                }
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        onEvent({ type: "error", content: err.message ?? "Stream failed" });
      }
    } finally {
      if (this._activeChatAbort === abort) {
        this._activeChatAbort = null;
      }
    }
  }

  // ── Calendar ──

  async getCalendarStatus() {
    return this.get("/api/calendar/status");
  }

  async startCalendarOAuth(payload) {
    return this.post("/api/calendar/oauth/start", payload);
  }

  async completeCalendarOAuth(payload) {
    return this.post("/api/calendar/oauth/complete", payload);
  }

  async disconnectCalendar(payload) {
    return this.post("/api/calendar/disconnect", payload);
  }

  async listCalendars(payload) {
    const q = payload?.connectionId
      ? `?connectionId=${encodeURIComponent(payload.connectionId)}`
      : "";
    return this.get(`/api/calendar/calendars${q}`);
  }

  async subscribeCalendar(payload) {
    return this.post("/api/calendar/subscribe", payload);
  }

  async unsubscribeCalendar({ subscriptionId }) {
    return this.delete(`/api/calendar/subscribe/${subscriptionId}`);
  }

  async updateCalendarSubscription({ subscriptionId, ...rest }) {
    return this.patch(`/api/calendar/subscribe/${subscriptionId}`, rest);
  }

  async addIcsSubscription(payload) {
    return this.post("/api/calendar/ics", payload);
  }

  async removeIcsSubscription({ id }) {
    return this.delete(`/api/calendar/ics/${id}`);
  }

  async updateIcsSubscription({ id, ...rest }) {
    return this.patch(`/api/calendar/ics/${id}`, rest);
  }

  async fetchCalendarEvents({ timeMin, timeMax }) {
    const q = new URLSearchParams({ timeMin, timeMax }).toString();
    const data = await this.get(`/api/calendar/events?${q}`);
    return data.events ?? data;
  }

  async createCalendarEvent(payload) {
    const data = await this.post("/api/calendar/events", payload);
    return data.event ?? data;
  }

  async updateCalendarEvent({ eventId, ...rest }) {
    const data = await this.patch(`/api/calendar/events/${eventId}`, rest);
    return data.event ?? data;
  }

  async deleteCalendarEvent({ eventId, subscriptionId }) {
    return this.delete(
      `/api/calendar/events/${eventId}?subscriptionId=${encodeURIComponent(subscriptionId)}`,
    );
  }

  async rsvpCalendarEvent({ eventId, ...rest }) {
    return this.post(`/api/calendar/events/${eventId}/rsvp`, rest);
  }

  // ── Attachments (same as before — HTTP already, just adapted) ──

  async uploadAttachment(endpoint, accessToken, { buffer, fileName, mimeType, documentId }) {
    const base = this.baseUrl(endpoint);
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType }), fileName);
    form.append("documentId", documentId);
    const response = await fetch(`${base}/api/attachments/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Upload failed (${response.status}): ${text}`);
    }
    return response.json();
  }

  resolveAttachmentUrl(endpoint, accessToken, contentUrl) {
    const base = this.baseUrl(endpoint);
    return `${base}${contentUrl}?token=${encodeURIComponent(accessToken)}`;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/desktop && node --test electron/services/http-client.test.mjs 2>&1
```

Expected: All 5 tests pass

- [ ] **Step 5: Commit**

```bash
cd apps/desktop && git add electron/services/http-client.mjs electron/services/http-client.test.mjs
git commit -m "feat(desktop): add http-client.mjs replacing gRPC backend-client with REST/SSE"
```

---

### Task 4: Rewrite main.mjs

Replace the initialization sequence and all IPC handlers in `main.mjs`. The file goes from ~884 lines to a cleaner ~600 lines. Delete the old service imports, add new ones.

**Files:**

- Modify: `apps/desktop/electron/main.mjs`

- [ ] **Step 1: Update imports and module-level variables**

Replace the import block at the top of `apps/desktop/electron/main.mjs` (lines 1–31) with:

```javascript
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  powerMonitor,
  protocol,
  shell,
} from "electron";
import { createServer } from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const heicConvert = require("heic-convert");

import { MetadataStore } from "./services/metadata-store.mjs";
import { NoteStore } from "./services/note-store.mjs";
import { HttpClient } from "./services/http-client.mjs";
import { CalendarReminderService } from "./services/calendar-reminder-service.mjs";
```

Replace the module-level variable declarations (lines 46–71) with:

```javascript
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.name = "Slate";
app.productName = "Slate";

const defaultUserData = app.getPath("userData");
if (defaultUserData.includes("Electron")) {
  app.setPath("userData", path.join(app.getPath("appData"), "Slate"));
}

let mainWindow;
let metadataStore;
let noteStore;
let httpClient;
let calendarReminderService;
let activeOidcAbort = null;

/** AbortController for active SSE chat stream (replaced gRPC stream.cancel). */
let activeSendMessageAbort = null;

function cancelActiveSendMessageStream() {
  httpClient?.cancelChatStream();
}
```

- [ ] **Step 2: Rewrite initialization in app.whenReady()**

Replace the `app.whenReady().then(async () => {` block's init section (lines 731–784) with:

```javascript
app.whenReady().then(async () => {
  protocol.handle("slate-attachment", (request) => {
    const filePath = decodeURIComponent(request.url.replace("slate-attachment://", ""));
    return net.fetch(pathToFileURL(filePath).href);
  });
  if (process.platform === "darwin" && app.dock) {
    const dockIconPath = path.join(__dirname, "../build/icon.png");
    const dockIcon = nativeImage.createFromPath(dockIconPath);
    app.dock.setIcon(dockIcon.isEmpty() ? dockIconPath : dockIcon);
  }

  metadataStore = new MetadataStore(app.getPath("userData"));
  noteStore = new NoteStore({ metadataStore });
  httpClient = new HttpClient({ metadataStore });

  const reminderIconPath = path.join(__dirname, "../build/icon.png");
  const reminderIcon = nativeImage.createFromPath(reminderIconPath);
  calendarReminderService = new CalendarReminderService({
    backendClient: httpClient,
    metadataStore,
    Notification,
    icon: reminderIcon.isEmpty() ? reminderIconPath : reminderIcon,
    soundPlayer: { beep: () => shell.beep() },
  });

  calendarReminderService.start();
  registerIpc();
  await createWindow();

  powerMonitor.on("resume", () => {
    void calendarReminderService?.handleWake?.();
  });
});
```

- [ ] **Step 3: Rewrite note CRUD IPC handlers in registerIpc()**

Replace the `registerIpc()` function in `apps/desktop/electron/main.mjs` with the following. Start by replacing the note-related handlers at the top of `registerIpc()`:

```javascript
function registerIpc() {
  const withReminderRefresh =
    (handler) =>
    async (event, ...args) => {
      const result = await handler(event, ...args);
      await calendarReminderService?.refreshNow?.();
      return result;
    };

  // ── Snapshot ──
  ipcMain.handle("desktop:getSnapshot", () => {
    const { notes, folders } = noteStore.getSnapshot();
    return {
      backend: buildBackendConfig(),
      notes,
      folders,
    };
  });

  // ── Note CRUD ──
  ipcMain.handle("desktop:createNote", (_event, parentPath) =>
    noteStore.createNote({ parentPath }),
  );
  ipcMain.handle("desktop:createDailyNote", () => noteStore.createDailyNote());
  ipcMain.handle("desktop:createFolder", (_event, parentPath) =>
    noteStore.createFolder(parentPath),
  );
  ipcMain.handle("desktop:listTemplates", () => noteStore.listTemplates());
  ipcMain.handle("desktop:createTemplate", (_event, parentPath) =>
    noteStore.createTemplate({ parentPath }),
  );
  ipcMain.handle("desktop:readTemplateContent", async () => null); // content in Y.Doc
  ipcMain.handle("desktop:loadNote", (_event, noteId) => noteStore.getNoteById(noteId));
  ipcMain.handle("desktop:saveNote", () => null); // no-op: content is in Y.Doc/Hocuspocus
  ipcMain.handle("desktop:rescanNote", () => null); // no-op
  ipcMain.handle("desktop:deleteNote", (_event, noteId) => noteStore.deleteNote(noteId));
  ipcMain.handle("desktop:togglePinNote", (_event, noteId, pinned) => {
    noteStore.togglePinNote(noteId, pinned);
    // Sync to backend if online
    const token = metadataStore.getSetting("accessToken");
    if (token) {
      httpClient.updateNoteRemote(noteId, { pinned }).catch(() => {});
    }
  });
  ipcMain.handle("desktop:moveNote", (_event, noteId, targetFolderPath) => {
    const note = noteStore.moveNote(noteId, targetFolderPath);
    const token = metadataStore.getSetting("accessToken");
    if (token) {
      httpClient.updateNoteRemote(noteId, { path: note.path }).catch(() => {});
    }
    return note;
  });
  ipcMain.handle("desktop:renameFolder", (_event, folderPath, nextName) => {
    noteStore.renameFolder(folderPath, nextName);
    mainWindow?.webContents.send("desktop:workspaceChanged", []);
  });
  ipcMain.handle("desktop:moveFolder", (_event, folderPath, targetParentPath) => {
    noteStore.moveFolder(folderPath, targetParentPath);
    mainWindow?.webContents.send("desktop:workspaceChanged", []);
  });
  ipcMain.handle("desktop:deleteFolder", (_event, folderPath) => {
    noteStore.deleteFolder(folderPath);
    mainWindow?.webContents.send("desktop:workspaceChanged", []);
  });
  ipcMain.handle("desktop:updateNotePlainText", (_event, noteId, plainText) => {
    noteStore.updatePlainText(noteId, plainText);
    const token = metadataStore.getSetting("accessToken");
    if (token) {
      httpClient.updateNoteRemote(noteId, { plainText }).catch(() => {});
    }
  });
```

- [ ] **Step 4: Rewrite auth/backend IPC handlers**

Add these handlers inside `registerIpc()`, after the note CRUD handlers:

```javascript
// ── Backend / Auth ──

function buildBackendConfig() {
  const endpoint = metadataStore.getSetting("backendEndpoint", "");
  const authStatus = metadataStore.getSetting("authStatus", "signed_out");
  const userId = metadataStore.getSetting("authenticatedUserId", null);
  const email = metadataStore.getSetting("authenticatedEmail", null);
  const displayName = metadataStore.getSetting("authenticatedDisplayName", null);
  const isAdmin = metadataStore.getSetting("authenticatedIsAdmin", false);
  const tokenExpiry = metadataStore.getSetting("tokenExpiresAtUnix", null);
  const providers = metadataStore.getSetting("authProviders", []);
  return {
    endpoint,
    clientId: metadataStore.getSetting("clientId", crypto.randomUUID()),
    backendReachable: metadataStore.getSetting("backendReachable", false),
    authStatus,
    authProviders: providers,
    authenticatedUserId: userId,
    authenticatedEmail: email,
    authenticatedDisplayName: displayName,
    authenticatedIsAdmin: isAdmin,
    tokenExpiresAtUnix: tokenExpiry,
  };
}

ipcMain.handle("desktop:setBackendEndpoint", async (_event, endpoint) => {
  const trimmed = typeof endpoint === "string" ? endpoint.trim() : "";
  if (!trimmed) return buildBackendConfig();
  // Normalize endpoint: store without gRPC port
  const normalized = trimmed.replace(/:50051$/, ":4000");
  metadataStore.setSetting("backendEndpoint", normalized);
  metadataStore.setSetting("backendReachable", false);
  metadataStore.setSetting("authStatus", "signed_out");
  // Attempt connection check
  try {
    const providers = await httpClient.listAuthProviders(normalized);
    metadataStore.setSetting("backendReachable", true);
    metadataStore.setSetting("authProviders", providers.providers ?? []);
  } catch {
    metadataStore.setSetting("backendReachable", false);
  }
  return buildBackendConfig();
});

ipcMain.handle("desktop:checkBackendConnection", async (_event, endpoint) => {
  return httpClient.checkConnection(endpoint);
});

ipcMain.handle("desktop:refreshBackendStatus", async () => {
  const endpoint = metadataStore.getSetting("backendEndpoint", "");
  if (endpoint) {
    try {
      const providers = await httpClient.listAuthProviders(endpoint);
      metadataStore.setSetting("backendReachable", true);
      metadataStore.setSetting("authProviders", providers.providers ?? []);
    } catch {
      metadataStore.setSetting("backendReachable", false);
    }
  }
  return buildBackendConfig();
});

ipcMain.handle("desktop:loginWithPassword", async (_event, payload) => {
  const endpoint = metadataStore.getSetting("backendEndpoint", "");
  const clientId = metadataStore.getSetting("clientId") ?? crypto.randomUUID();
  metadataStore.setSetting("clientId", clientId);
  const result = await httpClient.loginWithPassword(endpoint, { ...payload, clientId });
  metadataStore.setSetting("accessToken", result.tokens.accessToken);
  metadataStore.setSetting("refreshToken", result.tokens.refreshToken);
  metadataStore.setSetting("tokenExpiresAtUnix", result.tokens.expiresAtUnix);
  metadataStore.setSetting("authStatus", "authenticated");
  metadataStore.setSetting("authenticatedUserId", result.userId);
  metadataStore.setSetting("authenticatedEmail", result.email);
  metadataStore.setSetting("authenticatedDisplayName", result.displayName);
  metadataStore.setSetting("authenticatedIsAdmin", result.isAdmin);
  return buildBackendConfig();
});

ipcMain.handle("desktop:loginWithOidc", async (_event, providerId) => {
  if (typeof providerId !== "string" || !providerId.trim()) {
    throw new Error("providerId is required");
  }

  const callbackResult = await new Promise((resolve, reject) => {
    const openSockets = new Set();

    function teardown(reason) {
      activeOidcAbort = null;
      clearTimeout(timer);
      server.close(() => reject(new Error(reason)));
      for (const socket of openSockets) socket.destroy();
    }

    activeOidcAbort = () => teardown("OIDC login was cancelled");

    const server = createServer((request, response) => {
      const callbackBase = `http://127.0.0.1:${server.address()?.port ?? 0}`;
      const callbackUrl = new URL(request.url ?? "/", callbackBase);
      if (callbackUrl.pathname !== "/oidc/callback") {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }
      const code = callbackUrl.searchParams.get("code") ?? "";
      const state = callbackUrl.searchParams.get("state") ?? "";
      const error = callbackUrl.searchParams.get("error") ?? "";
      const errorDescription =
        callbackUrl.searchParams.get("error_description") ?? "OIDC login failed";
      response.setHeader("connection", "close");
      response.statusCode = error ? 400 : 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        `<!doctype html><html><body style="font-family: -apple-system, sans-serif; padding: 24px;">${
          error
            ? "Sign-in failed. You can close this window."
            : "Sign-in complete. You can close this window."
        }</body></html>`,
      );
      activeOidcAbort = null;
      clearTimeout(timer);
      server.close(() => {
        if (error) {
          reject(new Error(errorDescription));
          return;
        }
        if (!code || !state) {
          reject(new Error("OIDC callback is missing code/state"));
          return;
        }
        resolve({ code, state, redirectUri: `${callbackBase}/oidc/callback` });
      });
      for (const socket of openSockets) socket.destroy();
    });

    server.on("connection", (socket) => {
      openSockets.add(socket);
      socket.on("close", () => openSockets.delete(socket));
    });

    server.listen(0, "127.0.0.1", async () => {
      try {
        const port = server.address()?.port;
        if (!port || typeof port !== "number")
          throw new Error("Failed to bind OIDC callback listener");
        const redirectUri = `http://127.0.0.1:${port}/oidc/callback`;
        const endpoint = metadataStore.getSetting("backendEndpoint", "");
        const clientId = metadataStore.getSetting("clientId") ?? crypto.randomUUID();
        const started = await httpClient.startOidc(endpoint, {
          providerId: providerId.trim(),
          redirectUri,
          clientId,
        });
        await shell.openExternal(started.authorizationUrl);
      } catch (error) {
        activeOidcAbort = null;
        clearTimeout(timer);
        server.close(() => reject(error));
        for (const socket of openSockets) socket.destroy();
      }
    });

    const timer = setTimeout(() => teardown("Timed out waiting for OIDC callback"), 180_000);
  });

  const endpoint = metadataStore.getSetting("backendEndpoint", "");
  const clientId = metadataStore.getSetting("clientId") ?? crypto.randomUUID();
  const result = await httpClient.completeOidc(endpoint, {
    providerId: providerId.trim(),
    redirectUri: callbackResult.redirectUri,
    state: callbackResult.state,
    code: callbackResult.code,
    clientId,
  });
  metadataStore.setSetting("accessToken", result.tokens.accessToken);
  metadataStore.setSetting("refreshToken", result.tokens.refreshToken);
  metadataStore.setSetting("tokenExpiresAtUnix", result.tokens.expiresAtUnix);
  metadataStore.setSetting("authStatus", "authenticated");
  metadataStore.setSetting("authenticatedUserId", result.userId);
  metadataStore.setSetting("authenticatedEmail", result.email);
  metadataStore.setSetting("authenticatedDisplayName", result.displayName);
  metadataStore.setSetting("authenticatedIsAdmin", result.isAdmin);
  return buildBackendConfig();
});

ipcMain.handle("desktop:cancelOidc", () => {
  if (activeOidcAbort) activeOidcAbort();
});

ipcMain.handle("desktop:signOutBackend", () => {
  metadataStore.setSetting("accessToken", null);
  metadataStore.setSetting("refreshToken", null);
  metadataStore.setSetting("tokenExpiresAtUnix", null);
  metadataStore.setSetting("authStatus", "signed_out");
  metadataStore.setSetting("authenticatedUserId", null);
  metadataStore.setSetting("authenticatedEmail", null);
  metadataStore.setSetting("authenticatedDisplayName", null);
  httpClient.cancelChatStream();
  return buildBackendConfig();
});

ipcMain.handle("desktop:connectBackend", async () => {
  const endpoint = metadataStore.getSetting("backendEndpoint", "");
  if (!endpoint) return buildBackendConfig();
  try {
    const providers = await httpClient.listAuthProviders(endpoint);
    metadataStore.setSetting("backendReachable", true);
    metadataStore.setSetting("authProviders", providers.providers ?? []);
  } catch {
    metadataStore.setSetting("backendReachable", false);
  }
  return buildBackendConfig();
});

// Removed: syncNow, fullSync (no longer applicable — Hocuspocus handles content sync)
```

- [ ] **Step 5: Rewrite attachments, AI chat, and calendar IPC handlers**

Add these handlers inside `registerIpc()`, after the auth handlers:

```javascript
  // ── Attachments ──

  ipcMain.handle("desktop:uploadAttachment", async (_event, { buffer, fileName, mimeType, documentId }) => {
    let fileBuffer = Buffer.from(buffer);
    let finalMimeType = mimeType;
    let finalFileName = fileName;

    if (finalMimeType === "image/heic" || finalMimeType === "image/heif") {
      try {
        const jpegBuffer = await heicConvert({ buffer: fileBuffer, format: "JPEG", quality: 0.9 });
        fileBuffer = Buffer.from(jpegBuffer);
        finalMimeType = "image/jpeg";
        finalFileName = finalFileName.replace(/\.(heic|heif)$/i, ".jpg");
      } catch {
        // keep original if conversion fails
      }
    }

    const endpoint = metadataStore.getSetting("backendEndpoint", "");
    const token = metadataStore.getSetting("accessToken", "");
    return httpClient.uploadAttachment(endpoint, token, {
      buffer: fileBuffer,
      fileName: finalFileName,
      mimeType: finalMimeType,
      documentId,
    });
  });

  ipcMain.handle("desktop:resolveAttachmentUrl", (_event, contentUrl) => {
    const endpoint = metadataStore.getSetting("backendEndpoint", "");
    const token = metadataStore.getSetting("accessToken", "");
    return httpClient.resolveAttachmentUrl(endpoint, token, contentUrl);
  });

  // ── AI Chat ──

  ipcMain.handle("desktop:getAiConfig", () => httpClient.getAiConfig());
  ipcMain.handle("desktop:updateAiConfig", (_event, config) => httpClient.updateAiConfig(config));
  ipcMain.handle("desktop:createConversation", () => httpClient.createConversation());
  ipcMain.handle("desktop:listConversations", () => httpClient.listConversations());
  ipcMain.handle("desktop:deleteConversation", (_event, id) => httpClient.deleteConversation(id));
  ipcMain.handle("desktop:getConversationMessages", (_event, conversationId) =>
    httpClient.getConversationMessages(conversationId),
  );
  ipcMain.handle(
    "desktop:sendMessage",
    async (_event, conversationId, content, enabledCalendarIds, enabledIcsIds, timezone) => {
      if (httpClient.isStreamingChat()) {
        httpClient.cancelChatStream();
      }
      const events = [];
      let wasCancelled = false;

      const done = new Promise((resolve) => {
        void httpClient.streamSendMessage(
          {
            conversationId,
            content,
            enabledCalendarIds: enabledCalendarIds ?? [],
            enabledIcsIds: enabledIcsIds ?? [],
            timezone: timezone ?? "",
          },
          (event) => {
            mainWindow?.webContents.send("desktop:aiChatEvent", event);
            events.push(event);
          },
        ).then(() => {
          // If the last event was not done or error, check for cancellation
          const lastEvent = events[events.length - 1];
          wasCancelled = !lastEvent || (lastEvent.type !== "done" && lastEvent.type !== "error");
          resolve();
        });
      });

      await done;
      return wasCancelled ? { cancelled: true } : events;
    },
  );
  ipcMain.handle("desktop:cancelSendMessage", () => {
    httpClient.cancelChatStream();
  });
  ipcMain.handle("desktop:triggerEmbedding", () => httpClient.triggerEmbedding());

  // ── Calendar ──

  ipcMain.handle("desktop:getCalendarStatus", () => httpClient.getCalendarStatus());
  ipcMain.handle("desktop:startCalendarOAuth", withReminderRefresh((_event, payload) => httpClient.startCalendarOAuth(payload)));
  ipcMain.handle("desktop:disconnectCalendar", withReminderRefresh((_event, payload) => httpClient.disconnectCalendar(payload)));
  ipcMain.handle("desktop:listCalendars", (_event, payload) => httpClient.listCalendars(payload));
  ipcMain.handle("desktop:subscribeCalendar", withReminderRefresh((_event, payload) => httpClient.subscribeCalendar(payload)));
  ipcMain.handle("desktop:unsubscribeCalendar", withReminderRefresh((_event, payload) => httpClient.unsubscribeCalendar(payload)));
  ipcMain.handle("desktop:updateCalendarSubscription", withReminderRefresh((_event, payload) => httpClient.updateCalendarSubscription(payload)));
  ipcMain.handle("desktop:addIcsSubscription", withReminderRefresh((_event, payload) => httpClient.addIcsSubscription(payload)));
  ipcMain.handle("desktop:removeIcsSubscription", withReminderRefresh((_event, payload) => httpClient.removeIcsSubscription(payload)));
  ipcMain.handle("desktop:updateIcsSubscription", withReminderRefresh((_event, payload) => httpClient.updateIcsSubscription(payload)));
  ipcMain.handle("desktop:fetchCalendarEvents", (_event, payload) => httpClient.fetchCalendarEvents(payload));
  ipcMain.handle("desktop:createCalendarEvent", withReminderRefresh((_event, payload) => httpClient.createCalendarEvent(payload)));
  ipcMain.handle("desktop:updateCalendarEvent", withReminderRefresh((_event, payload) => httpClient.updateCalendarEvent(payload)));
  ipcMain.handle("desktop:deleteCalendarEvent", withReminderRefresh((_event, payload) => httpClient.deleteCalendarEvent(payload)));
  ipcMain.handle("desktop:rsvpCalendarEvent", withReminderRefresh((_event, payload) => httpClient.rsvpCalendarEvent(payload)));

  // ── Settings ──

  ipcMain.handle("desktop:getSetting", (_event, key) => metadataStore.getSetting(key));
  ipcMain.handle("desktop:setSetting", (_event, key, value) => metadataStore.setSetting(key, value));
  ipcMain.handle("desktop:getLastOpenNoteId", () => metadataStore.getSetting("lastOpenNoteId"));
  ipcMain.handle("desktop:setLastOpenNoteId", (_event, noteId) => metadataStore.setSetting("lastOpenNoteId", noteId));
  ipcMain.handle("desktop:getLastSidebarMode", () => metadataStore.getSetting("lastSidebarMode"));
  ipcMain.handle("desktop:setLastSidebarMode", (_event, mode) => metadataStore.setSetting("lastSidebarMode", mode));
  ipcMain.handle("desktop:getCalendarVisibilityFilters", () => metadataStore.getSetting("calendarVisibilityFilters"));
  ipcMain.handle("desktop:setCalendarVisibilityFilters", (_event, payload) => metadataStore.setSetting("calendarVisibilityFilters", payload));
  ipcMain.handle("desktop:getCalendarReminderSettings", () => metadataStore.getCalendarReminderSettings());
  ipcMain.handle("desktop:setCalendarReminderSettings", (_event, payload) => metadataStore.setCalendarReminderSettings(payload));
  ipcMain.handle("desktop:getLastCalendarView", () => metadataStore.getSetting("lastCalendarView"));
  ipcMain.handle("desktop:setLastCalendarView", (_event, view) => metadataStore.setSetting("lastCalendarView", view));
  ipcMain.handle("desktop:getLastCalendarDate", () => metadataStore.getSetting("lastCalendarDate"));
  ipcMain.handle("desktop:setLastCalendarDate", (_event, date) => metadataStore.setSetting("lastCalendarDate", date));
  ipcMain.handle("desktop:getLastActiveChatConversationId", () => metadataStore.getSetting("lastActiveChatConversationId"));
  ipcMain.handle("desktop:setLastActiveChatConversationId", (_event, id) => metadataStore.setSetting("lastActiveChatConversationId", id));
  ipcMain.handle("desktop:getKeyboardShortcuts", () => metadataStore.getShortcuts());
  ipcMain.handle("desktop:setKeyboardShortcut", (_event, action, shortcut) => metadataStore.setShortcut(action, shortcut));

  // ── UI helpers ──

  ipcMain.handle("desktop:showContextMenu", (_event, items) => {
    return new Promise((resolve) => {
      const template = items.map((item) => {
        if (item.type === "separator") return { type: "separator" };
        return {
          label: item.label,
          enabled: item.enabled !== false,
          click: () => resolve(item.id),
        };
      });
      template.push({ type: "separator" }, { label: "Cancel", click: () => resolve(null) });
      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: mainWindow, callback: () => resolve(null) });
    });
  });

  ipcMain.handle("desktop:getNotePath", (_event, noteId) => {
    const row = metadataStore.getNoteById(noteId);
    return row?.relative_path ?? null;
  });

  ipcMain.handle("desktop:getNoteCrdtState", () => null); // CRDT state lives in IndexedDB now

  ipcMain.handle("desktop:openExternal", async (_event, url) => {
    if (typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:"))) {
      await shell.openExternal(url);
    }
  });
} // end registerIpc
```

- [ ] **Step 6: Remove the activate sync logic from app.whenReady()**

Remove or comment out these lines from `app.whenReady()` (formerly lines 844–873):

```javascript
// DELETE these lines:
// if (syncService.syncEnabled()) { ... }
// app.on("activate", async () => { ... syncService.syncInBackground() ... })
```

Replace the `app.on("activate")` block with the minimal version:

```javascript
app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});
```

- [ ] **Step 7: Verify the app launches**

```bash
cd apps/desktop && npm run dev 2>&1 | head -30
```

Expected: App launches without "module not found" errors. Console may show "no backendEndpoint" which is normal.

- [ ] **Step 8: Commit**

```bash
cd apps/desktop && git add electron/main.mjs
git commit -m "feat(desktop): rewrite main.mjs — REST/SSE IPC handlers, remove gRPC/workspace service"
```

---

### Task 5: Update preload.mjs

Add `updateNotePlainText`. Remove `syncNow`, `fullSync`, `chooseWorkspaceDirectory`, `onSyncStatus`, `offSyncStatus`.

**Files:**

- Modify: `apps/desktop/electron/preload.mjs`

- [ ] **Step 1: Update preload.mjs**

In `apps/desktop/electron/preload.mjs`:

1. Remove these entries from the `contextBridge.exposeInMainWorld` object:
   - `chooseWorkspaceDirectory`
   - `syncNow`
   - `fullSync`

2. Add this entry after `rescanNote`:

```javascript
updateNotePlainText: (noteId, plainText) =>
  ipcRenderer.invoke("desktop:updateNotePlainText", noteId, plainText),
```

3. The `onSyncStatus`/`offSyncStatus` entries can stay (they're optional methods in api.ts) but will never fire since there's no sync service.

- [ ] **Step 2: Verify app still loads**

```bash
cd apps/desktop && npm run dev 2>&1 | grep -E "Error|error" | head -5
```

Expected: No new errors

- [ ] **Step 3: Commit**

```bash
cd apps/desktop && git add electron/preload.mjs
git commit -m "feat(desktop): update preload — add updateNotePlainText, remove sync IPC"
```

---

### Task 6: Update Shared Types and App.tsx

`LocalNoteSummary` loses `markdown`, `plainText`, `syncState`, `acceptedRevision`, `preview`. Gains `isTemplate`, `createdAt`. `DesktopSnapshot` loses `workspace`. App.tsx `persistNote` is replaced with a lightweight `updateNoteMetadata` call.

**Files:**

- Modify: `packages/shared/src/index.ts`
- Modify: `apps/desktop/src/lib/api.ts`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Update LocalNoteSummary in shared/src/index.ts**

Replace the `LocalNoteSummary` interface:

```typescript
export interface LocalNoteSummary {
  id: string;
  title: string;
  path: string;
  pinned: boolean;
  isTemplate: boolean;
  deleted: boolean;
  updatedAt: string;
  createdAt: string;
}
```

Replace the `DesktopSnapshot` interface:

```typescript
export interface DesktopSnapshot {
  backend: BackendConnectionConfig;
  notes: LocalNoteSummary[];
  folders: string[];
}
```

Keep `LocalLibraryProfile` for now but it will be unused — or simplify it:

```typescript
export interface LocalLibraryProfile {
  name: string;
}
```

- [ ] **Step 2: Update api.ts**

In `apps/desktop/src/lib/api.ts`:

1. Remove `saveNote` from the `DesktopApi` interface and the fallback implementation.
2. Remove `syncNow`, `fullSync`, `chooseWorkspaceDirectory` from the interface.
3. Add `updateNotePlainText`:

```typescript
updateNotePlainText(noteId: string, plainText: string): Promise<void>;
```

4. Update the browser fallback `async saveNote()` — remove it. Add:

```typescript
async updateNotePlainText() {
  // no-op in browser
},
```

5. Update the exported function wrapper at the bottom:

```typescript
export function updateNotePlainText(noteId: string, plainText: string) {
  return desktopApi().updateNotePlainText(noteId, plainText);
}
```

- [ ] **Step 3: Fix App.tsx — remove markdown persistence**

In `apps/desktop/src/App.tsx`:

1. Remove the import of `saveNote`. Add import of `updateNotePlainText`.

2. Find the `persistNote` function (~line 787) and replace it with:

```typescript
async function persistNoteMetadata(note: LocalNoteSummary, plainText: string) {
  try {
    // Update SQLite title + plain_text for offline search
    await updateNotePlainText(note.id, plainText);

    setSnapshot((current) => ({
      ...current,
      notes: current.notes
        .map((entry) =>
          entry.id === note.id ? { ...entry, updatedAt: new Date().toISOString() } : entry,
        )
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    }));
  } catch (err) {
    console.error("[App] persistNoteMetadata failed", err);
  }
}
```

3. Find the debounced save logic (the `useEffect` that serializes `selectedNote` and calls `persistNote`) and update it to use the new function. The key change is: we don't need to save markdown, just the plain text when content changes.

Find where `persistNote(noteSnapshot)` is called in the `useEffect` on `selectedNote` and update it:

```typescript
// Old:
void persistNote(noteSnapshot);

// New — pass content from the onContentChange callback
// See the onContentChange handler below for how plainText is captured
void persistNoteMetadata(noteSnapshot, lastPlainTextRef.current ?? "");
```

4. Add `lastPlainTextRef`:

```typescript
const lastPlainTextRef = useRef<string>("");
```

5. In `EditorWithSync` or wherever `onContentChange` is called, update to extract plain text:

```typescript
onContentChange={(md) => {
  // Extract plain text from markdown for offline search
  lastPlainTextRef.current = md.replace(/[#*_`~\[\]()>|-]/g, " ").replace(/\s+/g, " ").trim();
  // ... existing logic to update title from h1 ...
}}
```

6. Remove the `lastSavedRef` comparison that used `markdown` since we no longer track markdown in note state. The debounce only needs to fire when the title changes:

```typescript
// Simplified debounce — only trigger on title or content change indicator
// The actual plainText update is cheap (SQLite write), debounce to 2s
```

7. Remove all references to `selectedNote.markdown` in App.tsx. Note content is exclusively in the Y.Doc.

8. Remove `syncNow`, `fullSync` references from App.tsx (search and remove any calls).

- [ ] **Step 4: Fix TypeScript compilation errors**

```bash
cd apps/desktop && npm run lint 2>&1 | head -30
```

Fix any remaining TypeScript errors related to the type changes (e.g., `snapshot.workspace` references).

- [ ] **Step 5: Commit**

```bash
cd packages/shared && git add src/index.ts
cd apps/desktop && git add src/lib/api.ts src/App.tsx
git commit -m "feat: update LocalNoteSummary and DesktopSnapshot types, remove markdown from note state"
```

---

### Task 7: Remove gRPC from Backend

Now that the desktop uses REST, remove the gRPC server setup from the backend.

**Files:**

- Modify: `apps/core-backend/src/main.ts`
- Modify: `apps/core-backend/package.json`

- [ ] **Step 1: Remove gRPC from main.ts**

Replace `apps/core-backend/src/main.ts` with:

```typescript
import "./config/env";
import { NestFactory } from "@fastify/core";
import { Logger } from "fastify-pino";
import { WebSocketServer } from "ws";
import { AppModule } from "./app.module";
import { CollaborationGateway } from "./collaboration/collaboration.gateway";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Wire WebSocket upgrades on /collaboration to Hocuspocus BEFORE listen
  const logger = app.get(Logger);
  const gateway = app.get(CollaborationGateway);
  const wss = new WebSocketServer({ noServer: true });
  const httpServer = app.getHttpServer();
  httpServer.on("upgrade", (request: any, socket: any, head: any) => {
    logger.log(`[ws-upgrade] url=${request.url}`, "Bootstrap");
    if (request.url?.startsWith("/collaboration")) {
      wss.handleUpgrade(request, socket, head, (ws: any) => {
        logger.log(`[ws-upgrade] handshake complete, passing to Hocuspocus`, "Bootstrap");
        gateway.handleConnection(ws, request);
      });
    } else {
      logger.log(`[ws-upgrade] ignoring non-collaboration path: ${request.url}`, "Bootstrap");
      socket.destroy();
    }
  });

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 4000);
}

void bootstrap();
```

- [ ] **Step 2: Remove gRPC dependencies from backend package.json**

In `apps/core-backend/package.json`, remove from dependencies:

- `"@grpc/grpc-js": "..."`
- `"@grpc/proto-loader": "..."`
- `"@fastify/microservices": "..."` (if only used for gRPC — verify no other transport is used)

Run:

```bash
cd apps/core-backend && npm install
```

- [ ] **Step 3: Remove GrpcLoggingInterceptor import (if it was only in main.ts)**

Check if `apps/core-backend/src/common/grpc-logging.interceptor.ts` is referenced anywhere else:

```bash
grep -r "GrpcLoggingInterceptor\|grpc-logging" apps/core-backend/src/ --include="*.ts"
```

If only referenced from `main.ts` (now removed), delete it:

```bash
rm apps/core-backend/src/common/grpc-logging.interceptor.ts
```

- [ ] **Step 4: Remove gRPC imports from controllers**

The `@GrpcMethod` decorators in controllers will fail to compile without `@fastify/microservices`. Remove gRPC imports and decorators from:

- `apps/core-backend/src/auth/auth.controller.ts` — remove `GrpcMethod, RpcException` imports and all `@GrpcMethod` methods
- `apps/core-backend/src/ai/ai.controller.ts` — remove `@GrpcMethod` methods (keep the HTTP ones added in Phase 1)
- `apps/core-backend/src/calendar/calendar.controller.ts` — remove `@GrpcMethod` methods (keep HTTP ones)
- `apps/core-backend/src/documents/documents.controller.ts` — remove all gRPC methods (or delete the file if the module still needs a controller)

For auth.controller.ts: delete all `@GrpcMethod` methods. Keep `@Get/@Post` REST methods. Remove `Metadata, status` from imports and `GrpcMethod, RpcException` from imports.

For ai.controller.ts: delete all `@GrpcMethod` methods. Keep REST methods from Phase 1.

For calendar.controller.ts: delete all `@GrpcMethod` methods. Keep the OAuth callback `@Get` and all REST methods from Phase 1.

For documents.controller.ts: The gRPC-only document sync is no longer needed (Hocuspocus handles it). Delete all methods from the class body, or delete the file if the DocumentsModule controller is otherwise empty.

- [ ] **Step 5: Verify backend compiles**

```bash
cd apps/core-backend && npm run build 2>&1 | tail -20
```

Expected: No TypeScript errors

- [ ] **Step 6: Run all tests**

```bash
cd apps/core-backend && npm test 2>&1 | tail -10
```

Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
cd apps/core-backend && git add src/main.ts src/auth/auth.controller.ts src/ai/ai.controller.ts src/calendar/calendar.controller.ts src/documents/documents.controller.ts package.json package-lock.json
git commit -m "feat(backend): remove gRPC server — REST+SSE only on port 4000"
```

---

### Task 8: Delete Old Desktop Service Files + Remove npm Dependencies

**Files:**

- Delete: multiple old service files
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Delete old service files**

```bash
cd apps/desktop
rm electron/services/workspace-service.mjs
rm electron/services/sync-service.mjs
rm electron/services/sync-service.test.mjs
rm electron/services/ydoc-manager.mjs
rm electron/services/backend-client.mjs
rm electron/services/workspace-disk-reconcile.mjs
rm electron/services/note-crdt-state.mjs
rm electron/services/sync-logger.mjs
rm electron/services/file-watcher.mjs
rm electron/services/file-watcher.test.mjs
rm electron/services/disk-content-hash.mjs
```

Also check and remove `sync-intervals.mjs` if present:

```bash
rm -f electron/services/sync-intervals.mjs
```

- [ ] **Step 2: Remove npm dependencies**

In `apps/desktop/package.json`, remove from dependencies:

- `"chokidar": "..."`
- `"fast-glob": "..."`

Run:

```bash
cd apps/desktop && npm install
```

- [ ] **Step 3: Verify app still launches**

```bash
cd apps/desktop && npm run dev 2>&1 | head -20
```

Expected: App launches. No "Cannot find module" errors.

- [ ] **Step 4: Run desktop tests**

```bash
cd apps/desktop && node --test electron/services/note-store.test.mjs electron/services/http-client.test.mjs 2>&1
```

Expected: All tests pass

- [ ] **Step 5: Verify TypeScript**

```bash
cd apps/desktop && npm run lint 2>&1 | head -20
```

Expected: No errors (or only pre-existing warnings)

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(desktop): Phase 2 complete — remove gRPC/filesystem sync, REST+SSE+IndexedDB stack"
```
