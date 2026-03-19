import { ChevronRight, FileText, FolderOpen } from "lucide-react";
import type { ContextMenuItem as NativeMenuItem } from "../lib/api";
import { showContextMenu } from "../lib/api";
import type { NoteTreeNode } from "../lib/noteTree";
import { basename } from "../lib/noteTree";

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
  collapsedPaths,
  onTogglePath,
}: TreeBranchProps) {
  const isRoot = !node.name;
  const isCollapsed = node.path ? collapsedPaths.has(node.path) : false;

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
      {node.name ? (
        <button
          className="tree-folder"
          style={{ paddingLeft: `${depth * 14}px` }}
          onClick={() => onTogglePath(node.path)}
          onContextMenu={handleFolderContextMenu}
        >
          <ChevronRight size={14} className={`tree-folder__chevron ${isCollapsed ? "" : "is-open"}`} />
          <FolderOpen size={14} />
          <span>{node.name}</span>
        </button>
      ) : null}

      {!isCollapsed && node.notes.map((note) => (
        <button
          key={note.id}
          className={`note-row ${note.id === selectedNoteId ? "is-active" : ""}`}
          onClick={() => void onSelectNote(note.id)}
          onContextMenu={(e) => void handleNoteContextMenu(e, note.id)}
          style={{ paddingLeft: `${depth * 14 + (isRoot ? 8 : 22)}px` }}
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
          collapsedPaths={collapsedPaths}
          onTogglePath={onTogglePath}
        />
      ))}
    </div>
  );
}
