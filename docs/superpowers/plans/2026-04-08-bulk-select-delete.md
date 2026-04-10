# Bulk Select & Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shift/cmd-click multi-selection to the note tree sidebar with bulk delete via context menu.

**Architecture:** New `selectedItems` Set state in App.tsx, selection logic in NoteTree.tsx click handlers, new DeleteBulkDialog component. Selection scoped to siblings within a single parent folder.

**Tech Stack:** React, TypeScript, existing UI primitives (Dialog, Button, cn utility)

---

### Task 1: Create DeleteBulkDialog Component

**Files:**
- Create: `apps/desktop/src/components/DeleteBulkDialog.tsx`

- [ ] **Step 1: Create the dialog component**

```tsx
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

export interface DeleteBulkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onConfirm: () => Promise<void>;
}

export function DeleteBulkDialog({
  open,
  onOpenChange,
  count,
  onConfirm,
}: DeleteBulkDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {count} items</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{count} item{count !== 1 ? "s" : ""}</strong>?
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="dialog-secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="dialog-danger" onClick={() => void onConfirm()}>
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

### Task 2: Add Selection State to App.tsx

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Add selection state and ref**

Near line 259 (after `collapsedPaths` state), add:

```tsx
const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
const lastClickedItemRef = useRef<{ key: string; parentPath: string } | null>(null);
```

- [ ] **Step 2: Add bulk delete state**

Near line 251 (after `deletingNote` state), add:

```tsx
const [deletingBulk, setDeletingBulk] = useState<Set<string> | null>(null);
```

- [ ] **Step 3: Add helper to deduplicate selected items**

Add this function inside the `App` component, near the other delete handlers (around line 908):

```tsx
function deduplicateSelectedItems(items: Set<string>): Set<string> {
  const folderPaths: string[] = [];
  for (const key of items) {
    if (key.startsWith("folder:")) {
      folderPaths.push(key.slice("folder:".length));
    }
  }
  const deduped = new Set<string>();
  for (const key of items) {
    if (key.startsWith("note:")) {
      const noteId = key.slice("note:".length);
      const note = snapshot.notes.find((n) => n.id === noteId);
      if (note) {
        const isChild = folderPaths.some(
          (fp) => note.path.startsWith(fp + "/") || note.path.startsWith(fp + "\\"),
        );
        if (!isChild) deduped.add(key);
      }
    } else if (key.startsWith("folder:")) {
      const fp = key.slice("folder:".length);
      const isChild = folderPaths.some(
        (parentFp) => parentFp !== fp && (fp.startsWith(parentFp + "/") || fp.startsWith(parentFp + "\\")),
      );
      if (!isChild) deduped.add(key);
    }
  }
  return deduped;
}
```

- [ ] **Step 4: Add handleBulkDelete and confirmBulkDelete**

Add these functions near the other delete handlers:

```tsx
function handleBulkDelete() {
  if (selectedItems.size < 2) return;
  setDeletingBulk(deduplicateSelectedItems(selectedItems));
}

async function confirmBulkDelete() {
  if (!deletingBulk) return;
  const items = deletingBulk;
  setDeletingBulk(null);
  setSelectedItems(new Set());

  try {
    await flushPendingSave();

    const folderPaths: string[] = [];
    const noteIds: string[] = [];
    for (const key of items) {
      if (key.startsWith("folder:")) folderPaths.push(key.slice("folder:".length));
      else if (key.startsWith("note:")) noteIds.push(key.slice("note:".length));
    }

    for (const fp of folderPaths) {
      await deleteFolder(fp);
    }
    for (const id of noteIds) {
      await deleteNote(id);
    }

    await refreshSnapshot();

    if (selectedNoteId && (noteIds.includes(selectedNoteId) || folderPaths.some((fp) => {
      const note = snapshot.notes.find((n) => n.id === selectedNoteId);
      return note && (note.path.startsWith(fp + "/") || note.path.startsWith(fp + "\\"));
    }))) {
      setSelectedNoteId("");
      setSelectedNote(null);
      const remaining = snapshot.notes.filter(
        (n) => !noteIds.includes(n.id) && !folderPaths.some(
          (fp) => n.path.startsWith(fp + "/") || n.path.startsWith(fp + "\\"),
        ),
      );
      if (remaining[0]) {
        await handleSelectNote(remaining[0].id);
      }
    }
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : "Failed to delete items");
  }
}
```

- [ ] **Step 5: Add click handler for tree selection**

Add this function in App.tsx:

```tsx
function handleTreeItemClick(
  e: React.MouseEvent,
  itemKey: string,
  parentPath: string,
  siblingKeys: string[],
) {
  if (e.metaKey || e.ctrlKey) {
    // Cmd-click: toggle item in selection
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      return next;
    });
    lastClickedItemRef.current = { key: itemKey, parentPath };
    return true; // signal: handled as multi-select, don't open/collapse
  }

  if (e.shiftKey && lastClickedItemRef.current) {
    // Shift-click: range select within same parent
    if (lastClickedItemRef.current.parentPath !== parentPath) {
      // Different parent — fall back to cmd-click behavior (toggle)
      setSelectedItems((prev) => {
        const next = new Set(prev);
        if (next.has(itemKey)) next.delete(itemKey);
        else next.add(itemKey);
        return next;
      });
      lastClickedItemRef.current = { key: itemKey, parentPath };
      return true;
    }

    const anchorIdx = siblingKeys.indexOf(lastClickedItemRef.current.key);
    const targetIdx = siblingKeys.indexOf(itemKey);
    if (anchorIdx === -1 || targetIdx === -1) return false;

    const start = Math.min(anchorIdx, targetIdx);
    const end = Math.max(anchorIdx, targetIdx);
    const rangeKeys = siblingKeys.slice(start, end + 1);

    setSelectedItems((prev) => {
      const next = new Set(prev);
      for (const key of rangeKeys) next.add(key);
      return next;
    });
    // Don't update lastClickedItemRef on shift-click (anchor stays)
    return true;
  }

  // Plain click: clear selection
  if (selectedItems.size > 0) {
    setSelectedItems(new Set());
  }
  lastClickedItemRef.current = { key: itemKey, parentPath };
  return false; // not handled as multi-select, proceed with normal behavior
}
```

- [ ] **Step 6: Render DeleteBulkDialog**

Import `DeleteBulkDialog` at the top of App.tsx:

```tsx
import { DeleteBulkDialog } from "./components/DeleteBulkDialog";
```

Add the dialog near the other delete dialogs (after the `DeleteNoteDialog` around line 1917):

```tsx
<DeleteBulkDialog
  open={deletingBulk !== null}
  onOpenChange={(open) => {
    if (!open) setDeletingBulk(null);
  }}
  count={deletingBulk?.size ?? 0}
  onConfirm={confirmBulkDelete}
/>
```

- [ ] **Step 7: Pass new props to TreeBranch**

Update the `TreeBranch` usage (around line 1567) to include:

```tsx
<TreeBranch
  key={node.path || "root"}
  node={node}
  depth={0}
  selectedNoteId={selectedNoteId}
  selectedItems={selectedItems}
  onTreeItemClick={handleTreeItemClick}
  onBulkDelete={handleBulkDelete}
  onSelectNote={handleSelectNote}
  onDeleteNote={handleDeleteNote}
  onRenameNote={handleRenameNote}
  onCreateNote={handleCreateNote}
  onCreateFolder={handleCreateFolder}
  onRenameFolder={handleRenameFolder}
  onDeleteFolder={handleDeleteFolder}
  onMoveNote={handleMoveNote}
  onMoveFolder={handleMoveFolder}
  collapsedPaths={collapsedPaths}
  onTogglePath={togglePath}
  onTogglePin={handleTogglePin}
  onCreateTemplate={handleCreateTemplate}
/>
```

---

### Task 3: Update NoteTree.tsx — Props and Selection Logic

**Files:**
- Modify: `apps/desktop/src/components/NoteTree.tsx`

- [ ] **Step 1: Update TreeBranchProps interface**

At line 239, update `TreeBranchProps` to add the new props:

```tsx
export interface TreeBranchProps {
  node: NoteTreeNode;
  depth: number;
  selectedNoteId: string;
  selectedItems: Set<string>;
  onTreeItemClick: (
    e: React.MouseEvent,
    itemKey: string,
    parentPath: string,
    siblingKeys: string[],
  ) => boolean;
  onBulkDelete: () => void;
  onSelectNote: (noteId: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onRenameNote: (noteId: string, currentPath: string) => void;
  onCreateNote: (parentPath?: string) => Promise<void>;
  onCreateFolder: (parentPath?: string) => Promise<void>;
  onRenameFolder: (folderPath: string, currentName: string) => void;
  onDeleteFolder: (folderPath: string) => void;
  onMoveNote?: (noteId: string, targetFolderPath: string) => Promise<void>;
  onMoveFolder?: (folderPath: string, targetParentPath: string) => Promise<void>;
  collapsedPaths: Set<string>;
  onTogglePath: (path: string) => void;
  onCreateTemplate?: () => Promise<void>;
  onTogglePin?: (noteId: string, pinned: boolean) => void;
}
```

- [ ] **Step 2: Update TreeBranch destructuring and compute siblingKeys**

Update the `TreeBranch` function signature (line 258) to destructure the new props, and compute `siblingKeys`:

```tsx
export function TreeBranch({
  node,
  depth,
  selectedNoteId,
  selectedItems,
  onTreeItemClick,
  onBulkDelete,
  onSelectNote,
  onDeleteNote,
  onRenameNote,
  onCreateNote,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveNote,
  onMoveFolder,
  collapsedPaths,
  onTogglePath,
  onCreateTemplate,
  onTogglePin,
}: TreeBranchProps) {
  const isRoot = !node.name;
  const isCollapsed = node.path ? collapsedPaths.has(node.path) : false;
  const folderExpandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canAcceptTreeDrop = Boolean(onMoveNote || onMoveFolder);

  const siblingKeys = [
    ...node.folders.map((f) => `folder:${f.path}`),
    ...node.notes.map((n) => `note:${n.id}`),
  ];
```

- [ ] **Step 3: Update folder context menu to support bulk delete**

Replace the `handleFolderContextMenu` function with:

```tsx
async function handleFolderContextMenu(e: React.MouseEvent, folderNode: NoteTreeNode) {
  e.preventDefault();
  const folderKey = `folder:${folderNode.path}`;
  if (selectedItems.size >= 2 && selectedItems.has(folderKey)) {
    const items: NativeMenuItem[] = [
      { id: "bulk-delete", label: `Delete ${selectedItems.size} items` },
    ];
    const selected = await showContextMenu(items);
    if (selected === "bulk-delete") onBulkDelete();
    return;
  }

  const items: NativeMenuItem[] = [
    { id: "new-note", label: "New Note" },
    { id: "new-folder", label: "New Folder" },
    { type: "separator" },
    { id: "new-template", label: "New Template" },
    { type: "separator" },
    { id: "rename", label: "Rename Folder" },
    { type: "separator" },
    { id: "delete", label: "Delete Folder" },
  ];
  const selected = await showContextMenu(items);
  if (selected === "new-note") void onCreateNote(folderNode.path);
  else if (selected === "new-folder") void onCreateFolder(folderNode.path);
  else if (selected === "new-template") void onCreateTemplate?.();
  else if (selected === "rename") onRenameFolder(folderNode.path, folderNode.name);
  else if (selected === "delete") onDeleteFolder(folderNode.path);
}
```

- [ ] **Step 4: Update note context menu to support bulk delete**

Replace the `handleNoteContextMenu` function with:

```tsx
async function handleNoteContextMenu(e: React.MouseEvent, note: LocalNoteSummary) {
  e.preventDefault();
  const noteKey = `note:${note.id}`;
  if (selectedItems.size >= 2 && selectedItems.has(noteKey)) {
    const items: NativeMenuItem[] = [
      { id: "bulk-delete", label: `Delete ${selectedItems.size} items` },
    ];
    const selected = await showContextMenu(items);
    if (selected === "bulk-delete") onBulkDelete();
    return;
  }

  const items: NativeMenuItem[] = [];
  if (onTogglePin) {
    items.push({ id: "pin", label: note.pinned ? "Unpin Note" : "Pin Note" });
    items.push({ type: "separator", id: "sep-pin", label: "" });
  }
  items.push(
    { id: "rename", label: "Rename" },
    { type: "separator", id: "sep-rename", label: "" },
    { id: "delete", label: "Delete Note" },
  );
  const selected = await showContextMenu(items);
  if (selected === "delete") void onDeleteNote(note.id);
  else if (selected === "rename") onRenameNote(note.id, note.path);
  else if (selected === "pin") onTogglePin?.(note.id, !note.pinned);
}
```

- [ ] **Step 5: Update TreeFolderRow to accept selection props and handle clicks**

Update the `TreeFolderRow` props to add `isSelected`:

```tsx
function TreeFolderRow({
  node,
  depth,
  isCollapsed,
  isSelected,
  canAcceptTreeDrop,
  onMoveFolder,
  onTogglePath,
  onClick,
  onContextMenu,
  folderExpandTimer,
}: {
  node: NoteTreeNode;
  depth: number;
  isCollapsed: boolean;
  isSelected: boolean;
  canAcceptTreeDrop: boolean;
  onMoveFolder?: (folderPath: string, targetParentPath: string) => Promise<void>;
  onTogglePath: (path: string) => void;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  folderExpandTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}) {
```

In the folder row's `className`, update the line that has `isOver` (around line 130):

```tsx
isSelected ? "is-selected bg-white/[0.07]" : "",
isOver ? "bg-white/[0.07] outline outline-1 outline-white/[0.22]" : "hover:bg-white/[0.07]",
```

Replace the `onClick` handler on the div:

```tsx
onClick={onClick}
```

- [ ] **Step 6: Update TreeNoteRow to accept selection props and handle clicks**

Update the `TreeNoteRow` props to add `isSelected`:

```tsx
function TreeNoteRow({
  note,
  depth,
  isRoot,
  selectedNoteId,
  isSelected,
  onSelectNote,
  onClick,
  onContextMenu,
  onMoveNote,
}: {
  note: LocalNoteSummary;
  depth: number;
  isRoot: boolean;
  selectedNoteId: string;
  isSelected: boolean;
  onSelectNote: (noteId: string) => Promise<void>;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMoveNote?: (noteId: string, targetFolderPath: string) => Promise<void>;
}) {
```

In the note row's `className`, update the active/hover line (line 198):

```tsx
isSelected
  ? "is-selected bg-white/[0.07]"
  : note.id === selectedNoteId
    ? "is-active bg-white/[0.07]"
    : "hover:bg-white/[0.07]",
```

Replace the `onClick` handler on the div:

```tsx
onClick={onClick}
```

- [ ] **Step 7: Update TreeBranch render to wire everything together**

Update the `TreeFolderRow` usage in the render (around line 325):

```tsx
<TreeFolderRow
  node={node}
  depth={depth}
  isCollapsed={isCollapsed}
  isSelected={selectedItems.has(`folder:${node.path}`)}
  canAcceptTreeDrop={canAcceptTreeDrop}
  onMoveFolder={onMoveFolder}
  onTogglePath={onTogglePath}
  onClick={(e) => {
    const handled = onTreeItemClick(e, `folder:${node.path}`, node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : "", siblingKeys);
    if (!handled) onTogglePath(node.path);
  }}
  onContextMenu={(e) => void handleFolderContextMenu(e, node)}
  folderExpandTimer={folderExpandTimer}
/>
```

Update the `TreeNoteRow` usage (around line 347):

```tsx
{node.notes.map((note) => (
  <TreeNoteRow
    key={note.id}
    note={note}
    depth={depth}
    isRoot={isRoot}
    selectedNoteId={selectedNoteId}
    isSelected={selectedItems.has(`note:${note.id}`)}
    onSelectNote={onSelectNote}
    onClick={(e) => {
      const handled = onTreeItemClick(e, `note:${note.id}`, node.path, siblingKeys);
      if (!handled) void onSelectNote(note.id);
    }}
    onContextMenu={(e) => void handleNoteContextMenu(e, note)}
    onMoveNote={onMoveNote}
  />
))}
```

Update the recursive `TreeBranch` usage (around line 361) to pass the new props:

```tsx
{node.folders.map((child) => (
  <TreeBranch
    key={child.path}
    node={child}
    depth={depth + (isRoot ? 0 : 1)}
    selectedNoteId={selectedNoteId}
    selectedItems={selectedItems}
    onTreeItemClick={onTreeItemClick}
    onBulkDelete={onBulkDelete}
    onSelectNote={onSelectNote}
    onDeleteNote={onDeleteNote}
    onRenameNote={onRenameNote}
    onCreateNote={onCreateNote}
    onCreateFolder={onCreateFolder}
    onRenameFolder={onRenameFolder}
    onDeleteFolder={onDeleteFolder}
    onMoveNote={onMoveNote}
    onMoveFolder={onMoveFolder}
    collapsedPaths={collapsedPaths}
    onTogglePath={onTogglePath}
    onCreateTemplate={onCreateTemplate}
    onTogglePin={onTogglePin}
  />
))}
```

---

### Task 4: Compute Parent Path for Root-Level Folders

**Files:**
- Modify: `apps/desktop/src/components/NoteTree.tsx`

The folder click handler needs to determine its parent path for the `onTreeItemClick` call. For the `TreeFolderRow` rendered by `TreeBranch`, the parent is `node.path` of the *parent* branch — but for sub-folders, we need to derive the parent from the folder's own path.

- [ ] **Step 1: Fix parent path computation for folder clicks**

In the `TreeFolderRow` `onClick` handler (from Task 3 Step 7), the parent path derivation is already correct: `node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : ""` gives us the parent folder path for the clicked folder.

However, `siblingKeys` is computed from the *current* branch's `node` — which IS the parent of these folders/notes. So the parent path to pass should be the current `node.path`. Update the `TreeFolderRow` `onClick`:

```tsx
onClick={(e) => {
  const handled = onTreeItemClick(e, `folder:${node.path}`, node.path, siblingKeys);
  if (!handled) onTogglePath(node.path);
}}
```

Wait — `node` here IS the folder being clicked (since this is inside the `TreeBranch` that renders this folder as its header). The `siblingKeys` come from `node.folders` and `node.notes` — those are the *children* of this folder, not its siblings.

We need to receive the parent's `siblingKeys` and `parentPath` as props. Update `TreeBranchProps`:

```tsx
export interface TreeBranchProps {
  node: NoteTreeNode;
  depth: number;
  parentPath: string;
  parentSiblingKeys: string[];
  selectedNoteId: string;
  selectedItems: Set<string>;
  onTreeItemClick: (
    e: React.MouseEvent,
    itemKey: string,
    parentPath: string,
    siblingKeys: string[],
  ) => boolean;
  onBulkDelete: () => void;
  // ... rest unchanged
}
```

Update `TreeBranch` destructuring to include `parentPath` and `parentSiblingKeys`.

Update the `TreeFolderRow` `onClick`:

```tsx
onClick={(e) => {
  const handled = onTreeItemClick(e, `folder:${node.path}`, parentPath, parentSiblingKeys);
  if (!handled) onTogglePath(node.path);
}}
```

Update note `onClick` to use `siblingKeys` (children of current node, which IS the parent of notes):

```tsx
onClick={(e) => {
  const handled = onTreeItemClick(e, `note:${note.id}`, node.path, siblingKeys);
  if (!handled) void onSelectNote(note.id);
}}
```

Update folder context menu:

```tsx
onContextMenu={(e) => void handleFolderContextMenu(e, node)}
```

Update recursive `TreeBranch` to pass parent info:

```tsx
<TreeBranch
  key={child.path}
  node={child}
  depth={depth + (isRoot ? 0 : 1)}
  parentPath={node.path}
  parentSiblingKeys={siblingKeys}
  // ... rest of props
/>
```

Update App.tsx `TreeBranch` usage to pass root parent info:

```tsx
<TreeBranch
  key={node.path || "root"}
  node={node}
  depth={0}
  parentPath=""
  parentSiblingKeys={[]}
  // ... rest of props
/>
```

---

### Task 5: Build, Test, and Fix

**Files:**
- All modified files

- [ ] **Step 1: Run TypeScript compiler to check for type errors**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run the dev server to smoke test**

Run: `cd apps/desktop && npm run dev`
Expected: App loads, tree renders, clicking notes still works normally.

- [ ] **Step 3: Manual testing checklist**

1. Plain click on a note — opens it, clears any selection
2. Plain click on a folder — collapses/expands, clears any selection
3. Cmd-click on notes — toggles each in selection, does not open
4. Cmd-click on folders — toggles each in selection, does not collapse
5. Shift-click — selects range between anchor and target
6. Shift-click across different parents — falls back to toggle behavior
7. Right-click on selected item (2+ selected) — shows "Delete N items"
8. Right-click on unselected item — shows normal context menu, clears selection
9. Confirm bulk delete — items removed, editor updates if needed
10. Cancel bulk delete — selection preserved
