import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDraggable, useDroppable, useDndMonitor } from "@dnd-kit/core";
import { ChevronRight, FileText, FolderOpen, Pin } from "lucide-react";
import type { ContextMenuItem as NativeMenuItem } from "../lib/api";
import { showContextMenu } from "../lib/api";
import type { NoteTreeNode } from "../lib/noteTree";
import { basename } from "../lib/noteTree";
import {
  SLATE_TREE_DROP_ROOT_ID,
  dndDraggableFolderId,
  dndDraggableNoteId,
  dndDroppableFolderId,
} from "../lib/noteTreeDnd";
import type { LocalNoteSummary } from "@slate/shared";

/** Sets `notes-tree--sidebar-dnd-active` on `.notes-tree` while a tree note/folder drag runs (suppresses note hover noise). */
export function TreeSidebarDndHoverLock() {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const notesTreeRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    notesTreeRef.current = anchorRef.current?.closest(".notes-tree") ?? null;
  }, []);

  useDndMonitor({
    onDragStart({ active }) {
      const id = String(active.id);
      if (!id.startsWith("n:") && !id.startsWith("fs:")) return;
      notesTreeRef.current?.classList.add("notes-tree--sidebar-dnd-active");
    },
    onDragEnd() {
      notesTreeRef.current?.classList.remove("notes-tree--sidebar-dnd-active");
    },
    onDragCancel() {
      notesTreeRef.current?.classList.remove("notes-tree--sidebar-dnd-active");
    },
  });

  return (
    <span
      ref={anchorRef}
      className="tree-dnd-notes-tree-anchor"
      aria-hidden
    />
  );
}

function TreeRootDropZone({ canAccept }: { canAccept: boolean }) {
  const [treeDragActive, setTreeDragActive] = useState(false);
  useDndMonitor({
    onDragStart({ active }) {
      const id = String(active.id);
      setTreeDragActive(id.startsWith("n:") || id.startsWith("fs:"));
    },
    onDragEnd() {
      setTreeDragActive(false);
    },
    onDragCancel() {
      setTreeDragActive(false);
    },
  });
  const { setNodeRef, isOver } = useDroppable({ id: SLATE_TREE_DROP_ROOT_ID });
  if (!canAccept || !treeDragActive) return null;
  return (
    <div
      ref={setNodeRef}
      className={`tree-drop-root ${isOver ? "is-drop-target" : ""}`}
      aria-label="Drop at workspace root"
    />
  );
}

function TreeFolderRow({
  node,
  depth,
  isCollapsed,
  canAcceptTreeDrop,
  onMoveFolder,
  onTogglePath,
  onContextMenu,
  folderExpandTimer,
}: {
  node: NoteTreeNode;
  depth: number;
  isCollapsed: boolean;
  canAcceptTreeDrop: boolean;
  onMoveFolder?: (folderPath: string, targetParentPath: string) => Promise<void>;
  onTogglePath: (path: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  folderExpandTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: dndDraggableFolderId(node.path),
    disabled: !onMoveFolder,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dndDroppableFolderId(node.path),
    disabled: !canAcceptTreeDrop,
  });

  useEffect(() => {
    if (!isOver || !isCollapsed || !canAcceptTreeDrop) return;
    if (folderExpandTimer.current) clearTimeout(folderExpandTimer.current);
    folderExpandTimer.current = setTimeout(() => {
      folderExpandTimer.current = null;
      onTogglePath(node.path);
    }, 450);
    return () => {
      if (folderExpandTimer.current) {
        clearTimeout(folderExpandTimer.current);
        folderExpandTimer.current = null;
      }
    };
  }, [isOver, isCollapsed, canAcceptTreeDrop, node.path, onTogglePath, folderExpandTimer]);

  const setRefs = (el: HTMLDivElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };

  return (
    <div
      ref={setRefs}
      className={`tree-folder ${isOver ? "is-drop-target" : ""}`}
      style={{
        paddingLeft: `${depth * 14}px`,
        opacity: isDragging ? 0.35 : 1,
      }}
      onClick={() => onTogglePath(node.path)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTogglePath(node.path);
        }
      }}
      onContextMenu={onContextMenu}
      {...attributes}
      {...listeners}
    >
      <ChevronRight size={14} className={`tree-folder__chevron ${isCollapsed ? "" : "is-open"}`} />
      <FolderOpen size={14} className="tree-folder__icon" aria-hidden />
      <span className="tree-folder__label" title={node.name}>
        {node.name}
      </span>
    </div>
  );
}

function TreeNoteRow({
  note,
  depth,
  isRoot,
  selectedNoteId,
  onSelectNote,
  onContextMenu,
  onMoveNote,
}: {
  note: LocalNoteSummary;
  depth: number;
  isRoot: boolean;
  selectedNoteId: string;
  onSelectNote: (noteId: string) => Promise<void>;
  onContextMenu: (e: React.MouseEvent) => void;
  onMoveNote?: (noteId: string, targetFolderPath: string) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dndDraggableNoteId(note.id),
    disabled: !onMoveNote,
  });

  return (
    <div
      ref={setNodeRef}
      className={`note-row ${note.id === selectedNoteId ? "is-active" : ""} ${isDragging ? "note-row--drag-source" : ""}`}
      style={{
        paddingLeft: `${depth * 14 + (isRoot ? 8 : 22)}px`,
        opacity: isDragging ? 0.35 : 1,
      }}
      onClick={() => void onSelectNote(note.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void onSelectNote(note.id);
        }
      }}
      onContextMenu={(e) => void onContextMenu(e)}
      {...attributes}
      {...listeners}
    >
      <div className="note-row__icon">
        <FileText size={14} />
      </div>
      <div className="note-row__copy">
        <div className="note-row__title" title={basename(note.path)}>
          {basename(note.path)}
        </div>
      </div>
    </div>
  );
}

export interface TreeBranchProps {
  node: NoteTreeNode;
  depth: number;
  selectedNoteId: string;
  onSelectNote: (noteId: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onCreateNote: (parentPath?: string) => Promise<void>;
  onCreateFolder: (parentPath?: string) => Promise<void>;
  onRenameFolder: (folderPath: string, currentName: string) => void;
  onDeleteFolder: (folderPath: string) => void;
  onMoveNote?: (noteId: string, targetFolderPath: string) => Promise<void>;
  onMoveFolder?: (folderPath: string, targetParentPath: string) => Promise<void>;
  collapsedPaths: Set<string>;
  onTogglePath: (path: string) => void;
  onTogglePin?: (noteId: string, pinned: boolean) => void;
  onRescan?: (noteId: string) => void;
}

export function TreeBranch({
  node,
  depth,
  selectedNoteId,
  onSelectNote,
  onDeleteNote,
  onCreateNote,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveNote,
  onMoveFolder,
  collapsedPaths,
  onTogglePath,
  onTogglePin,
  onRescan,
}: TreeBranchProps) {
  const isRoot = !node.name;
  const isCollapsed = node.path ? collapsedPaths.has(node.path) : false;
  const folderExpandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canAcceptTreeDrop = Boolean(onMoveNote || onMoveFolder);

  async function handleFolderContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const items: NativeMenuItem[] = [
      { id: "new-note", label: "New Note" },
      { id: "new-folder", label: "New Folder" },
      { type: "separator" },
      { id: "rename", label: "Rename Folder" },
      { type: "separator" },
      { id: "delete", label: "Delete Folder" },
    ];
    const selected = await showContextMenu(items);
    if (selected === "new-note") void onCreateNote(node.path);
    else if (selected === "new-folder") void onCreateFolder(node.path);
    else if (selected === "rename") onRenameFolder(node.path, node.name);
    else if (selected === "delete") onDeleteFolder(node.path);
  }

  async function handleNoteContextMenu(e: React.MouseEvent, note: LocalNoteSummary) {
    e.preventDefault();
    const items: NativeMenuItem[] = [];
    if (onTogglePin) {
      items.push({ id: "pin", label: note.pinned ? "Unpin Note" : "Pin Note" });
      items.push({ type: "separator", id: "sep-pin", label: "" });
    }
    items.push(
      { id: "rescan", label: "Rescan from Disk" },
      { type: "separator", id: "sep1", label: "" },
      { id: "delete", label: "Delete Note" },
    );
    const selected = await showContextMenu(items);
    if (selected === "delete") void onDeleteNote(note.id);
    else if (selected === "pin") onTogglePin?.(note.id, !note.pinned);
    else if (selected === "rescan") onRescan?.(note.id);
  }

  return (
    <div className="tree-branch">
      {isRoot ? <TreeRootDropZone canAccept={canAcceptTreeDrop} /> : null}

      {node.name ? (
        <TreeFolderRow
          node={node}
          depth={depth}
          isCollapsed={isCollapsed}
          canAcceptTreeDrop={canAcceptTreeDrop}
          onMoveFolder={onMoveFolder}
          onTogglePath={onTogglePath}
          onContextMenu={handleFolderContextMenu}
          folderExpandTimer={folderExpandTimer}
        />
      ) : null}

      {!isCollapsed &&
        node.notes.map((note) => (
          <TreeNoteRow
            key={note.id}
            note={note}
            depth={depth}
            isRoot={isRoot}
            selectedNoteId={selectedNoteId}
            onSelectNote={onSelectNote}
            onContextMenu={(e) => void handleNoteContextMenu(e, note)}
            onMoveNote={onMoveNote}
          />
        ))}

      {!isCollapsed &&
        node.folders.map((child) => (
          <TreeBranch
            key={child.path}
            node={child}
            depth={depth + (isRoot ? 0 : 1)}
            selectedNoteId={selectedNoteId}
            onSelectNote={onSelectNote}
            onDeleteNote={onDeleteNote}
            onCreateNote={onCreateNote}
            onCreateFolder={onCreateFolder}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            onMoveNote={onMoveNote}
            onMoveFolder={onMoveFolder}
            collapsedPaths={collapsedPaths}
            onTogglePath={onTogglePath}
            onTogglePin={onTogglePin}
            onRescan={onRescan}
          />
        ))}
    </div>
  );
}

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

  async function handleContextMenu(e: React.MouseEvent, note: LocalNoteSummary) {
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
          key={`pinned-${note.id}`}
          type="button"
          className={`note-row ${note.id === selectedNoteId ? "is-active" : ""}`}
          onClick={() => void onSelectNote(note.id)}
          onContextMenu={(e) => void handleContextMenu(e, note)}
          style={{ paddingLeft: "8px" }}
        >
          <div className="note-row__icon">
            <Pin size={14} />
          </div>
          <div className="note-row__copy">
            <div className="note-row__title" title={basename(note.path)}>
              {basename(note.path)}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
