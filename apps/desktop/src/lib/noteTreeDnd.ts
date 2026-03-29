/** @dnd-kit unique ids for the sidebar note/folder tree (pointer-based DnD; avoids broken HTML5 DnD in Electron). */

export const SLATE_TREE_DROP_ROOT_ID = "fd:__slate_root__" as const;

export function dndDraggableNoteId(noteId: string): string {
  return `n:${noteId}`;
}

export function dndDraggableFolderId(path: string): string {
  return `fs:${encodeURIComponent(path)}`;
}

/** Parent folder path; empty string = workspace root. */
export function dndDroppableFolderId(parentPath: string): string {
  return parentPath === "" ? SLATE_TREE_DROP_ROOT_ID : `fd:${encodeURIComponent(parentPath)}`;
}

export function parseDndDropTargetId(overId: string): string | null {
  if (overId === SLATE_TREE_DROP_ROOT_ID) return "";
  if (!overId.startsWith("fd:")) return null;
  try {
    return decodeURIComponent(overId.slice(3));
  } catch {
    return null;
  }
}

export function parseDndActiveKind(
  activeId: string,
): { kind: "note"; noteId: string } | { kind: "folder"; path: string } | null {
  if (activeId.startsWith("n:")) {
    return { kind: "note", noteId: activeId.slice(2) };
  }
  if (activeId.startsWith("fs:")) {
    try {
      return { kind: "folder", path: decodeURIComponent(activeId.slice(3)) };
    } catch {
      return null;
    }
  }
  return null;
}
