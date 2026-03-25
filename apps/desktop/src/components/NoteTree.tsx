import { useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, FolderOpen } from "lucide-react";
import type { ContextMenuItem as NativeMenuItem } from "../lib/api";
import { showContextMenu } from "../lib/api";
import type { NoteTreeNode } from "../lib/noteTree";
import { basename } from "../lib/noteTree";

export const SLATE_NOTE_DRAG_MIME = "application/x-slate-note-id";

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
  collapsedPaths: Set<string>;
  onTogglePath: (path: string) => void;
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
  collapsedPaths,
  onTogglePath,
}: TreeBranchProps) {
  const isRoot = !node.name;
  const isCollapsed = node.path ? collapsedPaths.has(node.path) : false;
  const [folderDropActive, setFolderDropActive] = useState(false);
  const [rootDropActive, setRootDropActive] = useState(false);
  const folderExpandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [noteDragActive, setNoteDragActive] = useState(false);

  useEffect(() => {
    if (!isRoot || !onMoveNote) return;
    function onDragStart(e: DragEvent) {
      if (e.dataTransfer?.types.includes(SLATE_NOTE_DRAG_MIME)) {
        setNoteDragActive(true);
      }
    }
    function onDragEnd() { setNoteDragActive(false); }
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragend", onDragEnd);
    return () => {
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragend", onDragEnd);
    };
  }, [isRoot, onMoveNote]);

  function clearFolderExpandTimer() {
    if (folderExpandTimer.current) {
      clearTimeout(folderExpandTimer.current);
      folderExpandTimer.current = null;
    }
  }

  function isSlateNoteDrag(dataTransfer: DataTransfer | null) {
    return Boolean(dataTransfer?.types?.includes(SLATE_NOTE_DRAG_MIME));
  }

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

  async function handleNoteContextMenu(e: React.MouseEvent, noteId: string) {
    e.preventDefault();
    const items: NativeMenuItem[] = [
      { id: "delete", label: "Delete Note" },
    ];
    const selected = await showContextMenu(items);
    if (selected === "delete") void onDeleteNote(noteId);
  }

  return (
    <div className="tree-branch">
      {isRoot && onMoveNote && noteDragActive ? (
        <div
          className={`tree-drop-root ${rootDropActive ? "is-drop-target" : ""}`}
          onDragOver={(e) => {
            if (!isSlateNoteDrag(e.dataTransfer)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDragEnter={(e) => {
            if (!isSlateNoteDrag(e.dataTransfer)) return;
            setRootDropActive(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setRootDropActive(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setRootDropActive(false);
            if (!onMoveNote) return;
            const id = e.dataTransfer.getData(SLATE_NOTE_DRAG_MIME);
            if (!id) return;
            void onMoveNote(id, "");
          }}
        >
          Drop here for top level
        </div>
      ) : null}

      {node.name ? (
        <button
          type="button"
          className={`tree-folder ${folderDropActive ? "is-drop-target" : ""}`}
          style={{ paddingLeft: `${depth * 14}px` }}
          onClick={() => onTogglePath(node.path)}
          onContextMenu={handleFolderContextMenu}
          onDragOver={(e) => {
            if (!onMoveNote || !isSlateNoteDrag(e.dataTransfer)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDragEnter={(e) => {
            if (!onMoveNote || !isSlateNoteDrag(e.dataTransfer)) return;
            setFolderDropActive(true);
            if (isCollapsed) {
              clearFolderExpandTimer();
              folderExpandTimer.current = setTimeout(() => {
                folderExpandTimer.current = null;
                onTogglePath(node.path);
              }, 450);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setFolderDropActive(false);
              clearFolderExpandTimer();
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setFolderDropActive(false);
            clearFolderExpandTimer();
            if (!onMoveNote) return;
            const id = e.dataTransfer.getData(SLATE_NOTE_DRAG_MIME);
            if (!id) return;
            void onMoveNote(id, node.path);
          }}
        >
          <ChevronRight size={14} className={`tree-folder__chevron ${isCollapsed ? "" : "is-open"}`} />
          <FolderOpen size={14} />
          <span>{node.name}</span>
        </button>
      ) : null}

      {!isCollapsed && node.notes.map((note) => (
        <button
          key={note.id}
          type="button"
          draggable={Boolean(onMoveNote)}
          className={`note-row ${note.id === selectedNoteId ? "is-active" : ""}`}
          onClick={() => void onSelectNote(note.id)}
          onContextMenu={(e) => void handleNoteContextMenu(e, note.id)}
          style={{ paddingLeft: `${depth * 14 + (isRoot ? 8 : 22)}px` }}
          onDragStart={(e) => {
            if (!onMoveNote) return;
            e.dataTransfer.setData(SLATE_NOTE_DRAG_MIME, note.id);
            e.dataTransfer.effectAllowed = "move";
          }}
        >
          <div className="note-row__icon">
            <FileText size={14} />
          </div>
          <div className="note-row__copy">
            <div className="note-row__title">{basename(note.path)}</div>
          </div>
        </button>
      ))}

      {!isCollapsed && node.folders.map((child) => (
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
          collapsedPaths={collapsedPaths}
          onTogglePath={onTogglePath}
        />
      ))}
    </div>
  );
}
