# Markdown export (chooser + zip + inline attachments)

**Date:** 2026-04-11  
**Scope:** Desktop app — export a user-chosen set of notes to a single zip of `.md` files. Attachments referenced from note bodies appear as base64 `data:` URLs inside the markdown. Dynamic editor-only blocks (notably table of contents) become static markdown (nested lists).

## Goals

- User picks which notes to export (**chooser**), not the whole library by default.
- Output is a **zip** archive suitable for backup or moving to another tool.
- Each note is one file; **zip entry paths** match note `path` values (ensure `.md` extension consistent with import conventions).
- **Images / attachment-backed media** in the serialized markdown use `![alt](data:<mime>;base64,...)` so the archive is self-contained (no parallel `assets/` folder in v1).
- **Table of contents** nodes become a **static nested bullet list** reflecting the same heading scan as the live TOC (all headings in the document, ordered by position, indented by heading level). No HTML comment placeholder for export.

## Non-goals (v1)

- Exporting the entire library without a chooser.
- Streaming zip for extremely large libraries (v1 may buffer the zip in memory).
- Re-import round-trip guarantees beyond what already exists for markdown import.
- Encrypting or password-protecting the zip.

## UX

### Chooser dialog

- Lists the **same note hierarchy** as the sidebar (non-deleted notes, excluding items the sidebar would hide for trash/templates if applicable — match existing tree filters).
- **Checkbox per note**; user must pick at least one note to enable **Export**.
- **Cancel** closes without writing.
- Optional later: “select all under folder”; not required for v1.

### Entry points

- **Command bar / palette:** action such as “Export notes…” opening the chooser.
- **Settings → Storage** (or adjacent to existing import controls): secondary entry is acceptable if it groups backup/import/export affordances.

### Save flow

- After the user confirms Export, show the OS **save** dialog (default filename like `slate-export-YYYY-MM-DD.zip`).
- On success, dismiss the chooser and show a short confirmation; on failure, show the error and keep or reopen the chooser as appropriate.

## Data pipeline

### Source of truth

- Serialized body comes from **stored TipTap JSON** (`NoteDocType.content` in RxDB), not a separate markdown column (local schema has none).

### Steps (per note, then zip)

1. **Normalize** TipTap JSON into a ProseMirror document compatible with `slateSchema` / `slateMarkdownSerializer` (explicit mapping from editor JSON to schema node names where they differ, including lists, tasks, tables, code blocks, etc.).
2. **Expand `tableOfContents`:** before serialization, replace each such node with a `bullet_list` tree built by scanning the **entire** document for `heading` nodes (same semantics as the live `TableOfContents` React node view: level drives nesting, text is heading plain text).
3. **Serialize** to markdown using the shared serializer (`slateMarkdownSerializer`), extended or preceded by transforms so no TOC placeholder remains.
4. **Inline attachments:** resolve every remaining image `src` that refers to Slate-managed attachments (including `slate-attachment:` and `/api/attachments/...` forms). Load bytes, determine `mime`, replace markdown image target with `data:<mime>;base64,...`.
5. **Write** the UTF-8 markdown string into the zip at the path derived from the note’s `path` (sanitize path segments for zip safety: no absolute paths, no `..`).

### Zip assembly

- **Preferred:** build the zip in the **renderer** (or a shared package used by the renderer) with a lightweight library (e.g. `fflate`), then pass the final bytes to the **main process** via IPC to write to the user-selected path (reuse patterns similar to import for OS integration).
- Alternative acceptable variant: send `{ path, utf8 }[]` to main and zip there if attachment reads are simpler on the main side only — tradeoff is larger IPC payload.

### Image resolution failures

- **Default:** if any required attachment cannot be read, **abort the whole export** with a clear error naming the note and URL or id (avoid silent data loss).
- Document in UI copy that very large images increase zip size and memory use.

## Other editor-only nodes

- **Mermaid (and similar):** remain **fenced code blocks** with the appropriate language tag; no live rendering in the export file.
- Any future “dynamic” block should follow the same rule: export as static markdown that preserves readable meaning.

## Testing (high level)

- Unit tests for: TOC expansion from a sample TipTap JSON; markdown output contains nested list text matching headings; image URL replacement produces a `data:` URL prefix.
- Manual: export two notes with a shared attachment pattern, unzip, open `.md` in an external editor, confirm images render from `data:` URLs.

## Dependencies

- Add a **zip** dependency where the zip is built (renderer or main), chosen for small bundle size and synchronous API fit.

## Open decisions (locked for v1)

- **IPC vs renderer fetch for pending local attachments:** prefer `fetch(resolveAttachmentUrl(src))` in the renderer; add main-process read IPC only if Electron blocks the custom protocol in this context.
- **Fail-fast** on first missing attachment for the whole export (not per-note partial success).
