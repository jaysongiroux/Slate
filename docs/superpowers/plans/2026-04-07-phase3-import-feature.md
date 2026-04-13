# Phase 3: Import Feature

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repeatable "Import Notes" feature that scans a chosen directory for `.md` files, creates notes in SQLite, bootstraps Y.Docs with parsed content, and syncs to the backend if online. **Requires Phase 2 to be complete.**

**Architecture:** `import-service.mjs` runs in the Electron main process (filesystem + SQLite access). It recursively reads `.md` files, maps directory structure to virtual paths, creates notes via `NoteStore`, initializes Y.Doc state using `slateMarkdownParser`, and sends CRDT state to the backend via a batch REST call. A "Import Notes" button in `SettingsDialog.tsx` triggers it.

**Tech Stack:** Electron main process (Node.js), `node:sqlite`, `slateMarkdownParser` (from `@slate/shared`), Yjs (for bootstrapping Y.Docs), `fs/promises`.

---

## File Map

- Create: `apps/desktop/electron/services/import-service.mjs`
- Create: `apps/desktop/electron/services/import-service.test.mjs`
- Modify: `apps/desktop/electron/main.mjs` (add importFolder IPC handler)
- Modify: `apps/desktop/electron/preload.mjs` (add importFolder)
- Modify: `apps/desktop/src/lib/api.ts` (add importFolder type)
- Modify: `apps/desktop/src/components/SettingsDialog.tsx` (add Import Notes UI)
- Modify: `apps/core-backend/src/collaboration/collaboration.service.ts` (bootstrap Y.Doc from markdown on load)

---

### Task 1: Create import-service.mjs

Scans a directory recursively for `.md` files, creates notes in SQLite via `NoteStore`, serializes markdown to Yjs CRDT state, and batches the notes to the backend.

**Files:**

- Create: `apps/desktop/electron/services/import-service.mjs`
- Create: `apps/desktop/electron/services/import-service.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/electron/services/import-service.test.mjs`:

```javascript
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

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
    listNotes: () => db.prepare("SELECT * FROM notes WHERE deleted = 0").all(),
    isPathAvailable: (path) =>
      !db.prepare("SELECT 1 FROM notes WHERE relative_path = ? AND deleted = 0").get(path),
    listNotesByPrefix: (prefix) =>
      db
        .prepare("SELECT * FROM notes WHERE relative_path = ? OR relative_path LIKE ?")
        .all(prefix, `${prefix}/%`),
    markDeleted: (path) =>
      db.prepare("UPDATE notes SET deleted = 1 WHERE relative_path = ?").run(path),
    listTemplates: () =>
      db.prepare("SELECT * FROM notes WHERE is_template = 1 AND deleted = 0").all(),
    updatePlainText: (id, text) =>
      db.prepare("UPDATE notes SET plain_text = ? WHERE id = ?").run(text, id),
    setPinned: (id, val) =>
      db.prepare("UPDATE notes SET pinned = ? WHERE id = ?").run(val ? 1 : 0, id),
    upsertNote(note) {
      db.prepare(
        `
        INSERT INTO notes(id, relative_path, title, is_template, deleted, pinned, updated_at, created_at)
        VALUES (@id, @relativePath, @title, @isTemplate, @deleted, @pinned, @updatedAt, @createdAt)
        ON CONFLICT(id) DO UPDATE SET
          relative_path = excluded.relative_path,
          title = excluded.title,
          is_template = excluded.is_template,
          updated_at = excluded.updated_at
      `,
      ).run({
        id: note.id,
        relativePath: note.path ?? note.relativePath,
        title: note.title,
        isTemplate: note.isTemplate ? 1 : 0,
        deleted: 0,
        pinned: 0,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
    },
  };
}

import { NoteStore } from "./note-store.mjs";
import { ImportService } from "./import-service.mjs";

test("scanDirectory: finds .md files recursively", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slate-import-test-"));
  try {
    await writeFile(join(dir, "note1.md"), "# Hello\nWorld");
    await mkdir(join(dir, "projects"));
    await writeFile(join(dir, "projects", "note2.md"), "# Project Note");
    await mkdir(join(dir, "templates"));
    await writeFile(join(dir, "templates", "tmpl.md"), "# Template");

    const service = new ImportService({
      noteStore: new NoteStore({ metadataStore: makeTestStore() }),
    });
    const found = await service.scanDirectory(dir);
    assert.equal(found.length, 3, "should find 3 md files");
    const paths = found.map((f) => f.relativePath);
    assert.ok(paths.includes("note1"), "should include note1");
    assert.ok(paths.includes("projects/note2"), "should include nested note");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("scanDirectory: marks templates/ subdirectory files as isTemplate=true", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slate-import-test-"));
  try {
    await writeFile(join(dir, "note.md"), "# Note");
    await mkdir(join(dir, "templates"));
    await writeFile(join(dir, "templates", "tmpl.md"), "# Template");

    const service = new ImportService({
      noteStore: new NoteStore({ metadataStore: makeTestStore() }),
    });
    const found = await service.scanDirectory(dir);
    const tmpl = found.find((f) => f.relativePath.startsWith("templates/"));
    assert.ok(tmpl, "should find template");
    assert.equal(tmpl.isTemplate, true);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("importDirectory: creates notes in NoteStore", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slate-import-test-"));
  const store = makeTestStore();
  try {
    await writeFile(join(dir, "doc.md"), "# My Doc\nSome content here.");
    await writeFile(join(dir, "untitled.md"), "No heading");

    const noteStore = new NoteStore({ metadataStore: store });
    const service = new ImportService({ noteStore });
    const result = await service.importDirectory(dir);

    assert.equal(result.total, 2);
    assert.equal(result.imported, 2);
    const notes = noteStore.listNotes();
    assert.equal(notes.length, 2);
    const docNote = notes.find((n) => n.title === "My Doc");
    assert.ok(docNote, "should extract title from h1 heading");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("importDirectory: returns count of imported notes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slate-import-test-"));
  const store = makeTestStore();
  try {
    await writeFile(join(dir, "a.md"), "# A");
    await writeFile(join(dir, "b.md"), "# B");
    await writeFile(join(dir, "c.md"), "# C");

    const noteStore = new NoteStore({ metadataStore: store });
    const service = new ImportService({ noteStore });
    const result = await service.importDirectory(dir);

    assert.equal(result.total, 3);
    assert.equal(result.imported, 3);
  } finally {
    await rm(dir, { recursive: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/desktop && node --test electron/services/import-service.test.mjs 2>&1 | head -20
```

Expected: FAIL with "Cannot find module './import-service.mjs'"

- [ ] **Step 3: Create import-service.mjs**

Create `apps/desktop/electron/services/import-service.mjs`:

```javascript
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Extracts the title from markdown content.
 * Uses the first # heading, falls back to filename.
 */
function extractTitle(markdown, filename) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : filename;
}

/**
 * Converts a filesystem path relative to the import root into a virtual note path.
 * Strips the .md extension.
 */
function toVirtualPath(relativeFsPath) {
  return relativeFsPath.replace(/\\/g, "/").replace(/\.md$/i, "");
}

/**
 * Determines if a path is inside a templates/ subdirectory.
 */
function isTemplatePath(relativeFsPath) {
  const normalized = relativeFsPath.replace(/\\/g, "/");
  return normalized.startsWith("templates/") || normalized.includes("/templates/");
}

export class ImportService {
  constructor({ noteStore, httpClient = null }) {
    this._noteStore = noteStore;
    this._httpClient = httpClient;
  }

  /**
   * Recursively scans a directory for .md files.
   * Returns an array of { absolutePath, relativePath, isTemplate, filename }.
   */
  async scanDirectory(dirPath) {
    const results = [];

    async function walk(currentPath, relativeBase) {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const relativeFsPath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(fullPath, relativeFsPath);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          results.push({
            absolutePath: fullPath,
            relativePath: toVirtualPath(relativeFsPath),
            filename: entry.name.replace(/\.md$/i, ""),
            isTemplate: isTemplatePath(relativeFsPath),
          });
        }
      }
    }

    await walk(dirPath, "");
    return results;
  }

  /**
   * Imports all .md files from a directory into the note store.
   * Returns { total, imported, errors }.
   */
  async importDirectory(dirPath) {
    const files = await this.scanDirectory(dirPath);
    const total = files.length;
    let imported = 0;
    const errors = [];
    const importedNotes = [];

    for (const file of files) {
      try {
        let markdown = "";
        try {
          markdown = await fs.readFile(file.absolutePath, "utf-8");
        } catch {
          markdown = "";
        }

        const title = extractTitle(markdown, file.filename);
        const plainText = markdown
          .replace(/[#*_`~\[\]()>|-]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const id = crypto.randomUUID();

        const note = this._noteStore.upsertFromImport({
          id,
          path: file.relativePath,
          title,
          isTemplate: file.isTemplate,
        });

        // Update plain_text for offline search
        this._noteStore.updatePlainText(note.id, plainText);

        importedNotes.push({ id: note.id, path: note.path, title, markdown, plainText });
        imported++;
      } catch (err) {
        errors.push({ path: file.relativePath, error: err.message });
      }
    }

    // If online, batch-sync to backend
    if (this._httpClient && importedNotes.length > 0) {
      try {
        await this._httpClient.importNotesRemote(
          importedNotes.map(({ id, path, title, markdown, plainText }) => ({
            id,
            path,
            title,
            markdown,
            plainText,
          })),
        );
      } catch (err) {
        // Backend sync failure is non-fatal — notes are already in SQLite + IndexedDB
        console.warn("[ImportService] backend sync failed (non-fatal):", err.message);
      }
    }

    return { total, imported, errors };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/desktop && node --test electron/services/import-service.test.mjs 2>&1
```

Expected: All 4 tests pass

- [ ] **Step 5: Commit**

```bash
cd apps/desktop && git add electron/services/import-service.mjs electron/services/import-service.test.mjs
git commit -m "feat(desktop): add import-service.mjs for repeatable folder import of .md files"
```

---

### Task 2: Wire IPC in main.mjs and preload.mjs

**Files:**

- Modify: `apps/desktop/electron/main.mjs`
- Modify: `apps/desktop/electron/preload.mjs`

- [ ] **Step 1: Add ImportService import to main.mjs**

At the top of `apps/desktop/electron/main.mjs`, add to imports:

```javascript
import { ImportService } from "./services/import-service.mjs";
```

Add `importService` as a module-level variable:

```javascript
let importService;
```

In the `app.whenReady()` initialization block, after `httpClient` is created, add:

```javascript
importService = new ImportService({ noteStore, httpClient });
```

- [ ] **Step 2: Add importFolder IPC handler**

Inside `registerIpc()` in `apps/desktop/electron/main.mjs`, add this handler (after the note CRUD handlers):

```javascript
ipcMain.handle("desktop:importFolder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "Choose a folder to import",
    buttonLabel: "Import",
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  const dirPath = result.filePaths[0];

  // Scan first to show count before committing
  const files = await importService.scanDirectory(dirPath);
  const templateCount = files.filter((f) => f.isTemplate).length;
  const noteCount = files.length - templateCount;

  // Confirm with user
  const confirm = await dialog.showMessageBox({
    type: "question",
    buttons: ["Import", "Cancel"],
    defaultId: 0,
    title: "Import Notes",
    message: `Import ${noteCount} note${noteCount !== 1 ? "s" : ""}${templateCount > 0 ? ` and ${templateCount} template${templateCount !== 1 ? "s" : ""}` : ""}?`,
    detail: `From: ${dirPath}`,
  });

  if (confirm.response !== 0) {
    return null;
  }

  const importResult = await importService.importDirectory(dirPath);

  // Notify renderer that workspace changed
  mainWindow?.webContents.send("desktop:workspaceChanged", []);

  return {
    total: importResult.total,
    imported: importResult.imported,
    errors: importResult.errors.length,
  };
});
```

- [ ] **Step 3: Add importFolder to preload.mjs**

In `apps/desktop/electron/preload.mjs`, add inside `contextBridge.exposeInMainWorld`:

```javascript
importFolder: () => ipcRenderer.invoke("desktop:importFolder"),
```

- [ ] **Step 4: Verify no errors at startup**

```bash
cd apps/desktop && npm run dev 2>&1 | grep -E "Error|error" | head -5
```

Expected: No new errors

- [ ] **Step 5: Commit**

```bash
cd apps/desktop && git add electron/main.mjs electron/preload.mjs
git commit -m "feat(desktop): add importFolder IPC handler with folder picker + confirmation dialog"
```

---

### Task 3: Add Import UI in SettingsDialog.tsx + api.ts

**Files:**

- Modify: `apps/desktop/src/lib/api.ts`
- Modify: `apps/desktop/src/components/SettingsDialog.tsx`

- [ ] **Step 1: Add importFolder to api.ts**

In `apps/desktop/src/lib/api.ts`, add to the `DesktopApi` interface:

```typescript
importFolder(): Promise<{ total: number; imported: number; errors: number } | null>;
```

Add to the browser fallback implementation:

```typescript
async importFolder() {
  return null; // Not available in browser
},
```

Add an exported wrapper function at the bottom of the file:

```typescript
export function importFolder() {
  return desktopApi().importFolder();
}
```

- [ ] **Step 2: Add Import button to SettingsDialog.tsx**

First, read `apps/desktop/src/components/SettingsDialog.tsx` to understand its current structure. Then add an "Import Notes" section.

Find the section rendering the dialog content (look for an existing section like "Workspace" or "General"). Add a new section with an import button. The exact location depends on the current dialog structure, but the pattern is:

```tsx
import { importFolder } from "../lib/api";

// Inside the SettingsDialog component, add state:
const [importStatus, setImportStatus] = useState<string | null>(null);
const [isImporting, setIsImporting] = useState(false);

async function handleImport() {
  setIsImporting(true);
  setImportStatus(null);
  try {
    const result = await importFolder();
    if (result === null) {
      setImportStatus("Import cancelled.");
    } else if (result.errors > 0) {
      setImportStatus(
        `Imported ${result.imported} of ${result.total} notes (${result.errors} errors).`,
      );
    } else {
      setImportStatus(
        `Imported ${result.imported} note${result.imported !== 1 ? "s" : ""} successfully.`,
      );
    }
  } catch (err) {
    setImportStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setIsImporting(false);
  }
}
```

Add the import UI section in the dialog (in the General or a new "Data" section):

```tsx
<div className="space-y-3">
  <h3 className="text-sm font-medium text-[rgba(255,255,255,0.7)]">Import</h3>
  <div className="space-y-2">
    <p className="text-xs text-[rgba(255,255,255,0.4)]">
      Import notes from a folder of Markdown files. Subfolders map to virtual paths. Files in a{" "}
      <code>templates/</code> subfolder become templates. Safe to run multiple times.
    </p>
    <button
      type="button"
      onClick={handleImport}
      disabled={isImporting}
      className="px-3 py-1.5 text-sm rounded-[8px] bg-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.85)] disabled:opacity-50"
    >
      {isImporting ? "Importing…" : "Import Notes from Folder"}
    </button>
    {importStatus && <p className="text-xs text-[rgba(255,255,255,0.5)]">{importStatus}</p>}
  </div>
</div>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/desktop && npm run lint 2>&1 | head -20
```

Expected: No errors related to new importFolder type

- [ ] **Step 4: Test the import flow manually**

1. Launch the app: `cd apps/desktop && npm run dev`
2. Open Settings dialog
3. Click "Import Notes from Folder"
4. Choose a directory with some .md files
5. Confirm the import dialog
6. Verify notes appear in the sidebar
7. Open one imported note and verify content loads from IndexedDB (may show empty until Hocuspocus syncs)

Expected: Notes appear in sidebar tree with correct titles and paths.

- [ ] **Step 5: Commit**

```bash
cd apps/desktop && git add src/lib/api.ts src/components/SettingsDialog.tsx
git commit -m "feat(desktop): add Import Notes UI in settings dialog"
```

---

### Task 4: Bootstrap Y.Doc from Markdown on First Open

Without this task, imported notes open empty in the editor. This task updates `CollaborationService.handleLoadDocument` so that when a document has `markdown` content but no `crdtState`, it initializes the Y.Doc from the stored markdown using the existing `xmlFragmentToMarkdown` reverse path.

**Files:**

- Modify: `apps/core-backend/src/collaboration/collaboration.service.ts`

- [ ] **Step 1: Add bootstrapFromMarkdown to CollaborationService**

In `apps/core-backend/src/collaboration/collaboration.service.ts`, update `handleLoadDocument`:

```typescript
async handleLoadDocument(doc: Y.Doc, documentId: string, userId: string): Promise<void> {
  this.logger.log(`[load] looking up doc id=${documentId} userId=${userId}`);
  const record = await this.prisma.document.findFirst({
    where: { id: documentId, userId },
    select: { crdtState: true, markdown: true },
  });

  if (record?.crdtState) {
    this.logger.log(`[load] found existing crdtState (${record.crdtState.length} bytes)`);
    Y.applyUpdate(doc, new Uint8Array(record.crdtState));
  } else if (record?.markdown?.trim()) {
    this.logger.log(`[load] no crdtState, bootstrapping from markdown (${record.markdown.length} chars)`);
    this.bootstrapFromMarkdown(doc, record.markdown);
    // Persist the bootstrapped state so subsequent loads skip this path
    const crdtState = Buffer.from(Y.encodeStateAsUpdate(doc));
    await this.prisma.document.update({
      where: { id: documentId },
      data: { crdtState },
    });
  } else {
    this.logger.log(`[load] no existing document found`);
  }
}
```

Add the `bootstrapFromMarkdown` private method. It creates a simple paragraph node per line of the markdown, using the Y.XmlFragment that Hocuspocus expects (`prosemirror` field):

```typescript
private bootstrapFromMarkdown(doc: Y.Doc, markdown: string): void {
  const fragment = doc.getXmlFragment("prosemirror");
  if (fragment.length > 0) return; // already has content

  const lines = markdown.split(/\n\n+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const el = new Y.XmlElement("heading");
      el.setAttribute("level", String(level));
      const textNode = new Y.XmlText();
      textNode.insert(0, text);
      el.insert(0, [textNode]);
      fragment.insert(fragment.length, [el]);
    } else {
      const el = new Y.XmlElement("paragraph");
      const textNode = new Y.XmlText();
      textNode.insert(0, trimmed);
      el.insert(0, [textNode]);
      fragment.insert(fragment.length, [el]);
    }
  }
}
```

- [ ] **Step 2: Verify the backend compiles**

```bash
cd apps/core-backend && npm run build 2>&1 | tail -5
```

Expected: No TypeScript errors

- [ ] **Step 3: Test imported note shows content on first open**

1. Run the app: `cd apps/desktop && npm run dev`
2. Import a folder with a note that has heading + content
3. Click the note in the sidebar
4. Verify the editor shows the imported content (not empty)

Expected: Heading and paragraphs from the markdown appear in the editor on first open.

- [ ] **Step 4: Final commit**

```bash
cd apps/core-backend && git add src/collaboration/collaboration.service.ts
git commit -m "feat(backend): bootstrap Y.Doc from stored markdown when crdtState is absent (enables imported notes)"
```
