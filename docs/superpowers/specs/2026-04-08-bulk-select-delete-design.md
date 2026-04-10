# Bulk Select & Delete in Note Tree Sidebar

**Date:** 2026-04-08
**Scope:** Desktop app sidebar — multi-select notes and folders with shift/cmd-click, bulk delete via context menu.

## Selection Model

Standard desktop multi-select (like Finder):

- **Plain click** on a note: clears selection, selects + opens that note (existing behavior).
- **Plain click** on a folder: clears selection, toggles collapse (existing behavior).
- **Cmd-click** on a note or folder: toggles that item in/out of selection. Does not open the note or collapse the folder.
- **Shift-click** on a note or folder: selects the contiguous range from the last-clicked item to the shift-clicked item. Does not open or collapse.

Selection is **scoped to a single parent folder**. If shift-click target is in a different parent than the anchor, treat it as a cmd-click (toggle only).

When 2+ items are selected, the editor does not change — multi-select is purely a sidebar visual state for bulk operations.

Multi-select applies to the main tree only. The **pinned section** retains single-click-to-open behavior with no multi-select support.

## Selection State

New state in `App.tsx`:

- `selectedItems: Set<string>` — Items keyed as `note:<id>` or `folder:<path>`.
- `lastClickedItem: React.MutableRefObject<string | null>` — Anchor for shift-click range.

## Range Computation

Constrained to siblings within a single `NoteTreeNode` parent:

1. Build ordered list of children: `[...node.folders (as folder:<path>), ...node.notes (as note:<id>)]` — matches render order (folders sorted alphabetically first, then notes sorted alphabetically).
2. Find indices of `lastClickedItem` and shift-clicked item.
3. Select everything between those indices (inclusive).

If the two items are not in the same parent, fall back to cmd-click behavior (toggle only the clicked item).

## Visual Treatment

Selected items receive an `is-selected` class with the same `bg-white/[0.07]` highlight as the active note. Both `TreeNoteRow` and `TreeFolderRow` accept `selectedItems` and apply the class when their key is in the set.

## Context Menu

**Right-click on an item that IS in a multi-selection (2+ items):**
- Single menu item: "Delete X items" (deduplicated count — see below).

**Right-click on an item NOT in the selection:**
- Normal single-item context menu (current behavior).
- Clears the multi-selection.

## Bulk Delete

### Deduplication

Before executing delete, filter out any note or folder whose path is a descendant of a selected folder. The confirmation dialog shows the **deduplicated** count (e.g., selecting a folder with 3 notes inside + 1 sibling note = "Delete 2 items" not "Delete 5 items").

### Confirmation Dialog

New `DeleteBulkDialog` component:
- "Delete X items? This cannot be undone."
- Cancel / Delete buttons.
- Same styling as existing `DeleteNoteDialog` and `DeleteFolderDialog`.

### Execution

1. Flush pending save.
2. Delete selected folders first (via `deleteFolder` per folder).
3. Delete remaining selected notes (via `deleteNote` per note) — only those not already covered by a deleted folder.
4. Refresh snapshot once at the end.
5. If the currently-open note was among the deleted, clear editor and auto-select the first remaining note.
6. Clear `selectedItems`.

## Files Changed

| File | Change |
|------|--------|
| `apps/desktop/src/App.tsx` | New `selectedItems` state, `lastClickedItem` ref. `confirmBulkDelete` handler. Pass selection props to tree. New `deletingBulk` state for dialog. |
| `apps/desktop/src/components/NoteTree.tsx` | `TreeNoteRow` and `TreeFolderRow` accept `selectedItems` and apply `is-selected` class. `TreeBranch` handles cmd/shift-click modifiers. Bulk context menu when right-clicking a selected item. |
| `apps/desktop/src/components/DeleteBulkDialog.tsx` | New confirmation dialog for bulk delete. |

No changes to `noteTree.ts`, API layer, or backend.
