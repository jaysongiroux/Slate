import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDraggable, useDroppable, useDndMonitor } from "@dnd-kit/core";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, FileStack, FileText, FolderOpen, LayoutTemplate, Pin } from "lucide-react";
import type { ContextMenuItem as NativeMenuItem } from "../lib/api";
import { showContextMenu } from "../lib/api";
import type { NoteTreeNode } from "../lib/noteTree";
import { basename, isUnderTemplatesFolder } from "../lib/noteTree";
import {
  SLATE_TREE_DROP_ROOT_ID,
  dndDraggableFolderId,
  dndDraggableNoteId,
  dndDroppableFolderId,
} from "../lib/noteTreeDnd";
import type { LocalNoteSummary } from "@slate/shared";
import { cn } from "../lib/utils";

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

  return <span ref={anchorRef} className="sr-only" aria-hidden />;
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
      className={cn("tree-drop-root", isOver && "is-drop-target")}
      aria-label="Drop at workspace root"
    />
  );
}

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
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
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

  const isTemplatesFolder = node.path === "templates" || node.path === "templates/";
  const setRefs = (el: HTMLDivElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };

  return (
    <div
      ref={setRefs}
      className={cn(
        "flex max-w-full min-h-[30px] w-full min-w-0 cursor-pointer items-center rounded-sm gap-2 border-0 bg-transparent py-1 pr-2 text-left font-inherit text-[0.88rem] font-semibold text-muted transition-colors",
        "focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--accent,rgba(120,160,255,0.85))]",
        onMoveFolder && "cursor-grab active:cursor-grabbing",
        isSelected ? "is-selected bg-white/[0.07]" : "",
        isOver ? "bg-white/[0.07] outline outline-1 outline-white/[0.22]" : "hover:bg-white/[0.07]",
        isTemplatesFolder && "italic",
      )}
      style={{
        paddingLeft: `${depth * 14 + 8}px`,
        opacity: isDragging ? 0.35 : 1,
      }}
      onClick={onClick}
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
      <ChevronRight
        size={14}
        className={cn(
          "shrink-0 text-faint transition-transform duration-150 ease-[ease]",
          !isCollapsed && "rotate-90",
        )}
        aria-hidden
      />
      {isTemplatesFolder ? (
        <LayoutTemplate size={14} className="shrink-0" aria-hidden />
      ) : (
        <FolderOpen size={14} className="shrink-0" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate select-none" title={node.name}>
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
  const isTemplate = note.path.startsWith("templates/") || note.path.startsWith("templates\\");
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dndDraggableNoteId(note.id),
    disabled: !onMoveNote,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "note-row flex w-full max-w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-sm border-0 bg-transparent px-2 py-1 text-left transition-colors duration-150 ease-[ease]",
        "focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--accent,rgba(120,160,255,0.85))]",
        onMoveNote && "cursor-grab active:cursor-grabbing",
        isSelected
          ? "is-selected bg-white/[0.07]"
          : note.id === selectedNoteId
            ? "is-active bg-white/[0.07]"
            : "hover:bg-white/[0.07]",
        isDragging && "note-row--drag-source",
      )}
      style={{
        paddingLeft: `${depth * 14 + (isRoot ? 8 : 22)}px`,
        opacity: isDragging ? 0.35 : 1,
      }}
      onClick={onClick}
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
      <div
        className={cn(
          "flex size-[18px] shrink-0 items-center justify-center",
          isTemplate ? "text-muted" : "text-faint",
        )}
      >
        {isTemplate ? <FileStack size={14} /> : <FileText size={14} />}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "truncate text-[0.9rem] font-medium select-none",
            isTemplate ? "italic text-muted" : "text-foreground",
          )}
          title={basename(note.path)}
        >
          {basename(note.path)}
        </div>
      </div>
    </div>
  );
}

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
  onClearSelection: () => void;
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
  onCreateTemplate?: (parentPath?: string) => Promise<void>;
  onTogglePin?: (noteId: string, pinned: boolean) => void;
}

export function TreeBranch({
  node,
  depth,
  parentPath,
  parentSiblingKeys,
  selectedNoteId,
  selectedItems,
  onTreeItemClick,
  onBulkDelete,
  onClearSelection,
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

    onClearSelection();
    const items: NativeMenuItem[] = [
      { id: "new-note", label: "New Note" },
      { id: "new-folder", label: "New Folder" },
    ];
    if (isUnderTemplatesFolder(folderNode.path)) {
      items.push({ type: "separator" });
      items.push({ id: "new-template", label: "New Template" });
    }
    items.push(
      { type: "separator" },
      { id: "rename", label: "Rename Folder" },
      { type: "separator" },
      { id: "delete", label: "Delete Folder" },
    );
    const selected = await showContextMenu(items);
    if (selected === "new-note") void onCreateNote(folderNode.path);
    else if (selected === "new-folder") void onCreateFolder(folderNode.path);
    else if (selected === "new-template") void onCreateTemplate?.(folderNode.path);
    else if (selected === "rename") onRenameFolder(folderNode.path, folderNode.name);
    else if (selected === "delete") onDeleteFolder(folderNode.path);
  }

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

    onClearSelection();
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

  return (
    <div className="tree-branch relative grid min-w-0 gap-1">
      {isRoot ? <TreeRootDropZone canAccept={canAcceptTreeDrop} /> : null}

      {node.name ? (
        <TreeFolderRow
          node={node}
          depth={depth}
          isCollapsed={isCollapsed}
          isSelected={selectedItems.has(`folder:${node.path}`)}
          canAcceptTreeDrop={canAcceptTreeDrop}
          onMoveFolder={onMoveFolder}
          onTogglePath={onTogglePath}
          onClick={(e) => {
            const handled = onTreeItemClick(
              e,
              `folder:${node.path}`,
              parentPath,
              parentSiblingKeys,
            );
            if (!handled) onTogglePath(node.path);
          }}
          onContextMenu={(e) => void handleFolderContextMenu(e, node)}
          folderExpandTimer={folderExpandTimer}
        />
      ) : null}

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            key="folder-contents"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="grid min-w-0 gap-1 overflow-hidden"
          >
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

            {node.folders.map((child) => (
              <TreeBranch
                key={child.path}
                node={child}
                depth={depth + (isRoot ? 0 : 1)}
                parentPath={node.path}
                parentSiblingKeys={siblingKeys}
                selectedNoteId={selectedNoteId}
                selectedItems={selectedItems}
                onTreeItemClick={onTreeItemClick}
                onBulkDelete={onBulkDelete}
                onClearSelection={onClearSelection}
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
          </motion.div>
        )}
      </AnimatePresence>
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
    <div className="mb-1 min-w-0 border-b border-border-soft pb-1">
      <div className="cursor-default select-none px-2 pb-0.5 pt-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-muted">
        Pinned
      </div>
      {sorted.map((note) => (
        <button
          key={`pinned-${note.id}`}
          type="button"
          className={cn(
            "note-row flex w-full max-w-full min-w-0 cursor-pointer items-center gap-2.5 rounded border-0 bg-transparent px-2 py-1 text-left transition-colors duration-150 ease-[ease]",
            "focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--accent,rgba(120,160,255,0.85))]",
            note.id === selectedNoteId ? "is-active bg-white/[0.07]" : "hover:bg-white/[0.07]",
          )}
          onClick={() => void onSelectNote(note.id)}
          onContextMenu={(e) => void handleContextMenu(e, note)}
          style={{ paddingLeft: "8px" }}
        >
          <div className="flex size-[18px] shrink-0 items-center justify-center text-faint">
            <Pin size={14} />
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div
              className="truncate text-[0.9rem] font-medium text-foreground"
              title={basename(note.path)}
            >
              {basename(note.path)}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
