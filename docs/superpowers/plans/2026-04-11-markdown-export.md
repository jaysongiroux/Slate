# Markdown export (chooser + zip + base64) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick notes in a dialog, export them as `.md` files inside a zip with attachment images inlined as base64 `data:` URLs, and replace table-of-contents blocks with static nested bullet lists matching live TOC semantics.

**Architecture:** Add a TipTap-JSON → `slateSchema` JSON converter in `@slate/shared` (inverse of `toTiptapJson` plus edge cases), then TOC expansion on JSON, `Node.fromJSON` + `slateMarkdownSerializer`, then async image URL inlining using `fetch` on `resolveAttachmentUrl` results. Build the zip in the renderer with `fflate`, then IPC to the main process for `showSaveDialog` + `fs.writeFile`. UI: new dialog with tree + checkboxes, opened from Settings → Storage and optionally a keyboard shortcut / command entry.

**Tech Stack:** TypeScript, RxDB (`NoteDocType`), `@slate/shared` (prosemirror-model, existing serializer), `fflate`, Electron `dialog` + `fs/promises`, Vitest for shared unit tests.

**Spec:** `docs/superpowers/specs/2026-04-11-markdown-export-design.md`

---

### Task 1: TipTap JSON → slate JSON converter (shared)

**Files:**

- Create: `packages/shared/src/tiptap-to-slate-json.ts`
- Modify: `packages/shared/src/index.ts` (export new symbols)
- Test: `packages/shared/src/tiptap-to-slate-json.test.ts`

**Behavior:** Implement `tiptapDocJsonToSlateDocJson(root: unknown): { type: "doc"; content: unknown[] }` that recursively maps editor JSON to names/structure `slateSchema` + `Node.fromJSON` accept: reverse `BACKEND_TO_TIPTAP` from `tiptap-ydoc.ts` (node + mark renames). `taskList` / `taskItem` → `bullet_list` whose children are `list_item` with `attrs.checked` boolean (mirror `toTiptapJson` logic in reverse). Block-level `image` nodes (TipTap) → wrap in `paragraph` with inline `image` (slate schema has image as inline). `table` / `tableRow`: if a row contains only `tableHeader` cells, emit `table_header_row` with `table_header` children; otherwise `table_row` with `table_cell` / `table_header` per TipTap. Unwrap `__expanded` never appears on input from DB. Unknown node types: pass through if name exists in slateSchema, else strip or map to `paragraph` with plain text (document choice: **skip unknown with empty paragraph** only if needed for mermaid — `codeBlock` maps to `code_block` with `attrs.language`).

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/tiptap-to-slate-json.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Node } from "prosemirror-model";
import { slateSchema } from "./schema";
import { tiptapDocJsonToSlateDocJson } from "./tiptap-to-slate-json";

describe("tiptapDocJsonToSlateDocJson", () => {
  it("converts bulletList to bullet_list for slateSchema", () => {
    const tiptap = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
            },
          ],
        },
      ],
    };
    const slateJson = tiptapDocJsonToSlateDocJson(tiptap);
    const doc = Node.fromJSON(slateSchema, slateJson);
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild!.type.name).toBe("bullet_list");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && pnpm test src/tiptap-to-slate-json.test.ts`  
Expected: FAIL (module or function not found).

- [ ] **Step 3: Implement `tiptapDocJsonToSlateDocJson`**

Add `packages/shared/src/tiptap-to-slate-json.ts` with the recursive mapper (inverse map object mirroring `BACKEND_TO_TIPTAP`, mark map `bold`→`strong`, etc.), task list and table rules above, and block-image wrapping.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && pnpm test src/tiptap-to-slate-json.test.ts`  
Expected: PASS.

- [ ] **Step 5: Add tests for taskList and block image**

Extend the same test file: (1) `taskList` with one `taskItem` checked → `bullet_list` + `list_item` with `attrs.checked: true`. (2) Top-level `{ type: "image", attrs: { src: "/x", alt: "a" } }` → valid `doc` with `paragraph` wrapping inline image.

- [ ] **Step 6: Export from `packages/shared/src/index.ts`**

```typescript
export { tiptapDocJsonToSlateDocJson } from "./tiptap-to-slate-json";
```

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/tiptap-to-slate-json.ts packages/shared/src/tiptap-to-slate-json.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): convert TipTap doc JSON to slate schema JSON for export"
```

---

### Task 2: Expand `tableOfContents` into nested bullet lists (shared)

**Files:**

- Create: `packages/shared/src/export-expand-toc.ts`
- Test: `packages/shared/src/export-expand-toc.test.ts`
- Modify: `packages/shared/src/index.ts`

**Algorithm:** `expandTableOfContentsInDocJson(docJson: any): any` — deep-clone the doc tree. First walk the entire document and collect `{ level, text }[]` from every `heading` node (TipTap or slate name `heading`) in document order, using concatenated text from heading content. Second walk: when visiting a node with `type === "tableOfContents"`, replace it with a nested `bullet_list` / `list_item` / `paragraph` / `text` tree that matches the live sidebar TOC: use a stack keyed by heading level so each item sits under the nearest lower-level parent (same nesting idea as `TableOfContents.tsx` padding by level).

- [ ] **Step 1: Write failing test**

`packages/shared/src/export-expand-toc.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { expandTableOfContentsInDocJson } from "./export-expand-toc";

it("replaces tableOfContents with nested bullets for headings", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
      { type: "tableOfContents" },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Details" }],
      },
    ],
  };
  const out = expandTableOfContentsInDocJson(doc);
  const tocIdx = out.content.findIndex((n: any) => n.type === "bullet_list");
  expect(tocIdx).toBeGreaterThan(-1);
  const mdLike = JSON.stringify(out);
  expect(mdLike).toContain("Intro");
  expect(mdLike).toContain("Details");
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd packages/shared && pnpm test src/export-expand-toc.test.ts`

- [ ] **Step 3: Implement `expandTableOfContentsInDocJson`**

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Export + commit**

```bash
git add packages/shared/src/export-expand-toc.ts packages/shared/src/export-expand-toc.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): expand TOC nodes to static bullet lists for export"
```

---

### Task 3: Serialize export markdown (shared)

**Files:**

- Create: `packages/shared/src/export-note-markdown.ts`
- Test: `packages/shared/src/export-note-markdown.test.ts`
- Modify: `packages/shared/src/index.ts`

Implement `noteContentToMarkdown(content: Record<string, unknown>): string`:

1. `expandTableOfContentsInDocJson(content)` — must run **while node types are still TipTap names** (`tableOfContents`, `heading`, etc.).
2. `tiptapDocJsonToSlateDocJson(...)`
3. `Node.fromJSON(slateSchema, json)`
4. `slateMarkdownSerializer.serialize(doc).trimEnd()`

- [ ] **Step 1: Failing test** — fixture doc with heading + paragraph → markdown contains `#` and text.

- [ ] **Step 2: Run vitest — FAIL**

- [ ] **Step 3: Implement `noteContentToMarkdown`**

- [ ] **Step 4: PASS + commit**  
  `git commit -m "feat(shared): serialize note TipTap content to markdown for export"`

---

### Task 4: Inline attachment images in markdown (shared)

**Files:**

- Create: `packages/shared/src/export-inline-images.ts`
- Test: `packages/shared/src/export-inline-images.test.ts`
- Modify: `packages/shared/src/index.ts`

Implement `inlineAttachmentImagesInMarkdown(markdown: string, resolveUrl: (src: string) => Promise<string>, fetchBinary: (absoluteUrl: string) => Promise<{ bytes: Uint8Array; mime: string }>): Promise<string>`:

- Match markdown images: `/!\[([^\]]*)\]\(([^)]+)\)/g` (or a robust regex for one line per image).
- For each `src`, if it matches **Slate attachment** patterns (`^/api/attachments/`, `^slate-attachment:`, optional `http`+`/api/attachments/` after resolve): call `resolveUrl(src)` then `fetchBinary`, base64-encode, replace `src` with `data:${mime};base64,${b64}`.
- External `https?://` URLs **not** matching your attachment host: **leave unchanged** (spec only requires Slate attachments).
- On `fetchBinary` throw: propagate to caller (desktop will abort whole export).

- [ ] **Step 1: Unit test with mock `fetchBinary`** — input `![x](/api/attachments/a/content)` → output starts with `![x](data:`.

- [ ] **Step 2: Implement + PASS + commit**  
  `git commit -m "feat(shared): inline Slate attachment images as base64 in markdown"`

---

### Task 5: Zip path helper + fflate dependency (desktop)

**Files:**

- Create: `apps/desktop/src/lib/export-zip-path.ts`
- Test: `apps/desktop/src/lib/export-zip-path.test.ts` (if Vitest configured for desktop; else skip test file and add a quick `packages/shared` `sanitizeZipEntryPath` instead and import from desktop)
- Modify: `apps/desktop/package.json` — add `"fflate": "^0.8.2"` (or current stable)

Implement `sanitizeZipEntryPath(notePath: string): string`:

- Strip leading `/`, reject `..` segments, normalize separators to `/`.
- Ensure entry ends with `.md` (append if missing; if path ends with `.markdown`, normalize to `.md` per import conventions).

- [ ] **Step 1: Test `sanitizeZipEntryPath("foo/bar")` → `"foo/bar.md"`**

- [ ] **Step 2: Implement + add fflate + commit**  
  `git commit -m "feat(desktop): add zip path helper and fflate for export"`

---

### Task 6: IPC — save zip with native dialog (main + preload + types)

**Files:**

- Modify: `apps/desktop/electron/main.mjs` — `ipcMain.handle("desktop:saveZipExport", async (_e, payload) => { ... })` where `payload` is `{ defaultFilename: string, data: Uint8Array }`. Use `dialog.showSaveDialog(mainWindow, { defaultPath: join(app.getPath('documents'), defaultFilename), filters: [{ name: "Zip", extensions: ["zip"] }] })`, then `await fs.promises.writeFile(filePath, Buffer.from(data))`. Return `{ ok: true, path }` or `{ canceled: true }`.
- Modify: `apps/desktop/electron/preload.mjs` — `saveZipExport: (payload) => invoke("desktop:saveZipExport", payload)`
- Modify: `apps/desktop/src/lib/api/ipc-core.ts` — extend `DesktopApi` and `desktopApi()` implementation with `saveZipExport(payload: { defaultFilename: string; data: Uint8Array }): Promise<{ ok: true; path: string } | { canceled: true }>`.

- [ ] **Step 1: Implement main handler** (import `fs/promises`, `dialog` already present).

- [ ] **Step 2: Wire preload + ipc-core**

- [ ] **Step 3: Manual smoke** — from DevTools in packaged/dev app, `window.slateDesktop.saveZipExport({ defaultFilename: "test.zip", data: new Uint8Array([80,75,3,4]) })` should open save dialog (minimal zip header optional).

- [ ] **Step 4: Commit**  
  `git commit -m "feat(desktop): IPC to save zip export with system dialog"`

---

### Task 7: Export orchestration hook (renderer)

**Files:**

- Create: `apps/desktop/src/hooks/useMarkdownExport.ts`
- Uses: `getDatabase`, `NoteDocType`, `@slate/shared` exports (`noteContentToMarkdown`, `inlineAttachmentImagesInMarkdown`), `zip` from `fflate`, `sanitizeZipEntryPath`, `desktopApi().resolveAttachmentUrl`, `desktopApi().saveZipExport`

**Flow:** `exportNotesToZip(noteIds: string[]): Promise<void>`

1. Load each note from `db.notes.find({ selector: { id: { $in: noteIds } } })` (or one-by-one); skip missing.
2. For each note: `let md = noteContentToMarkdown(note.content as any)` then `md = await inlineAttachmentImagesInMarkdown(md, resolveAttachmentUrl, async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(...); const buf = new Uint8Array(await r.arrayBuffer()); return { bytes: buf, mime: r.headers.get("content-type")?.split(";")[0] || "application/octet-stream" }; })`.
3. `import { zip } from "fflate"` — build `Record<string, Uint8Array>` keys = `sanitizeZipEntryPath(note.path)`, values = `new TextEncoder().encode(md)`.
4. `zip(files, { level: 6 }, (err, u8) => { ... })` promisify with `new Promise`.
5. `saveZipExport({ defaultFilename: \`slate-export-${new Date().toISOString().slice(0,10)}.zip\`, data: u8 })`.
6. On any error, throw with note id + message for UI toast.

- [ ] **Step 1: Implement hook**

- [ ] **Step 2: Manual test** — two small notes without images.

- [ ] **Step 3: Commit**  
  `git commit -m "feat(desktop): orchestrate markdown export to zip"`

---

### Task 8: Export chooser dialog + UI wiring

**Files:**

- Create: `apps/desktop/src/components/ExportNotesDialog.tsx` — modal with scrollable tree built from `buildNoteTree` (`apps/desktop/src/lib/noteTree.ts`) using the same note list filters as the sidebar (`useNotes` / exclude deleted; match template/trash rules from `NotesSidebar.tsx` or wherever the main tree gets its data).
- Checkbox per **note** only (folders expand/collapse but do not export as files).
- State: `Set<string>` of selected note ids; Export disabled if empty; busy state while `exportNotesToZip` runs.
- Modify: `apps/desktop/src/stores/ui-store.ts` — add `exportNotesOpen: boolean` and `setExportNotesOpen`.
- Modify: `apps/desktop/src/components/DialogManager.tsx` — render `ExportNotesDialog` when open.
- Modify: `apps/desktop/src/App.tsx` (or parent that has `notes` + `db`) — pass `notes`, `db`, `onExported`, open/close from store.
- Modify: `apps/desktop/src/components/settings/StorageSection.tsx` — add “Export notes…” button calling `setExportNotesOpen(true)` (thread prop from `SettingsDialog`).
- Modify: `apps/desktop/src/components/SettingsDialog.tsx` — pass the new callback.

**Copy:** Short hint that large images increase memory and zip size; on failure show full error.

- [ ] **Step 1: Dialog + store + DialogManager**

- [ ] **Step 2: Storage section button**

- [ ] **Step 3: Commit**  
  `git commit -m "feat(desktop): export notes chooser dialog and settings entry"`

---

### Task 9: Command palette / shortcut entry (optional but spec’d)

**Files:**

- Modify: `apps/desktop/src/hooks/useAppKeyboardShortcuts.ts` — e.g. `Cmd+Shift+E` opens export dialog **only if** no conflict (grep existing shortcuts).
- **Alternative:** Extend `CommandBar.tsx` to show a pinned first row “Export notes…” when query is empty or matches `export`, calling `setExportNotesOpen(true)` and closing the command bar.

Pick **one** minimal approach that matches existing patterns; prefer **shortcut + Storage** if CommandBar refactor is large.

- [ ] **Step 1: Implement chosen entry**

- [ ] **Step 2: Document default shortcut in `StorageSection` helper text if added**

- [ ] **Step 3: Commit**  
  `git commit -m "feat(desktop): keyboard shortcut to open markdown export"`

---

## Spec self-review (plan author)

1. **Spec coverage:** Chooser (Task 8) ✓ | Zip (Tasks 5–7) ✓ | Base64 attachments (Task 4 + 7) ✓ | TOC static list (Tasks 2–3) ✓ | Mermaid unchanged via normal `code_block` path (Task 1) ✓ | Fail-fast on image (Task 7 throws) ✓ | Save dialog default name (Task 6) ✓ | Entry points (Tasks 8–9) ✓.
2. **Placeholder scan:** None intentional.
3. **Consistency:** TOC expansion runs on stored TipTap JSON **before** `tiptapDocJsonToSlateDocJson` (Task 3 order above) so `heading` / `tableOfContents` types match what `expandTableOfContentsInDocJson` expects.

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-04-11-markdown-export.md`.

**Two execution options:**

1. **Subagent-driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. **REQUIRED SUB-SKILL:** superpowers:subagent-driven-development.

2. **Inline execution** — Run tasks in this session with checkpoints. **REQUIRED SUB-SKILL:** superpowers:executing-plans.

Which approach do you want?
