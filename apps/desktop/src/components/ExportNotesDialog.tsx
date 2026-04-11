import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalNoteSummary } from "@slate/shared";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useDatabase } from "../db/DatabaseProvider";
import { useMarkdownExport } from "../hooks/useMarkdownExport";
import { basename, buildNoteTree, type NoteTreeNode } from "../lib/noteTree";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

const CHECK_COL = "flex w-7 shrink-0 justify-center";
const CHEVRON_COL = "flex size-7 shrink-0 items-center justify-center";
const ROW = "flex min-h-10 items-center gap-1 pr-2 text-[0.82rem] text-foreground";
const ROW_DIVIDER = "border-b border-white/[0.06]";

export interface ExportNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notes: LocalNoteSummary[];
  folders: string[];
}

function noteLabel(note: LocalNoteSummary): string {
  const t = note.title?.trim();
  if (t) return t;
  return basename(note.path);
}

function collectNoteIdsUnderFolder(node: NoteTreeNode): string[] {
  const ids = node.notes.map((n) => n.id);
  for (const sub of node.folders) {
    ids.push(...collectNoteIdsUnderFolder(sub));
  }
  return ids;
}

function folderCheckboxState(
  subtreeNoteIds: string[],
  selected: Set<string>,
): boolean | "indeterminate" {
  if (subtreeNoteIds.length === 0) return false;
  const k = subtreeNoteIds.filter((id) => selected.has(id)).length;
  if (k === 0) return false;
  if (k === subtreeNoteIds.length) return true;
  return "indeterminate";
}

function ExportTree({
  folders,
  notes,
  depth,
  collapsedPaths,
  onToggleFolder,
  selectedIds,
  onToggleNote,
  onSetManySelected,
}: {
  folders: NoteTreeNode[];
  notes: LocalNoteSummary[];
  depth: number;
  collapsedPaths: Set<string>;
  onToggleFolder: (path: string) => void;
  selectedIds: Set<string>;
  onToggleNote: (id: string) => void;
  onSetManySelected: (ids: string[], selected: boolean) => void;
}) {
  const padLeft = 10 + depth * 14;

  return (
    <div className="flex flex-col">
      {folders.map((folder) => {
        const collapsed = collapsedPaths.has(folder.path);
        const subtreeIds = collectNoteIdsUnderFolder(folder);
        const folderChecked = folderCheckboxState(subtreeIds, selectedIds);
        const hasChildren = folder.folders.length > 0 || folder.notes.length > 0;

        return (
          <div key={folder.path}>
            <div
              className={cn(ROW, ROW_DIVIDER)}
              style={{ paddingLeft: padLeft }}
            >
              <div className={CHECK_COL}>
                <Checkbox
                  checked={folderChecked}
                  disabled={subtreeIds.length === 0}
                  onCheckedChange={(v) => {
                    if (subtreeIds.length === 0) return;
                    onSetManySelected(subtreeIds, v === true);
                  }}
                  className="size-4 shrink-0"
                  aria-label={`Select all notes in ${folder.name}`}
                />
              </div>
              {hasChildren ? (
                <button
                  type="button"
                  className={cn(
                    CHEVRON_COL,
                    "rounded-md text-faint transition-colors hover:bg-white/[0.06] hover:text-muted",
                  )}
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? `Expand ${folder.name}` : `Collapse ${folder.name}`}
                  onClick={() => onToggleFolder(folder.path)}
                >
                  <ChevronRight
                    className={cn("size-4 transition-transform duration-150", !collapsed && "rotate-90")}
                    strokeWidth={2}
                  />
                </button>
              ) : (
                <span className={cn(CHEVRON_COL)} aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate text-muted">{folder.name}</span>
            </div>
            {!collapsed ? (
              <ExportTree
                folders={folder.folders}
                notes={folder.notes}
                depth={depth + 1}
                collapsedPaths={collapsedPaths}
                onToggleFolder={onToggleFolder}
                selectedIds={selectedIds}
                onToggleNote={onToggleNote}
                onSetManySelected={onSetManySelected}
              />
            ) : null}
          </div>
        );
      })}
      {notes.map((note) => (
        <label
          key={note.id}
          className={cn(ROW, ROW_DIVIDER, "cursor-pointer hover:bg-white/[0.03]")}
          style={{ paddingLeft: padLeft }}
        >
          <div className={CHECK_COL}>
            <Checkbox
              checked={selectedIds.has(note.id)}
              onCheckedChange={() => onToggleNote(note.id)}
              className="size-4 shrink-0"
              aria-label={noteLabel(note)}
            />
          </div>
          <span className="min-w-0 flex-1 truncate pl-8">
            {noteLabel(note)}
          </span>
        </label>
      ))}
    </div>
  );
}

export function ExportNotesDialog({ open, onOpenChange, notes, folders }: ExportNotesDialogProps) {
  const db = useDatabase();
  const { exportNotesToZip, exporting } = useMarkdownExport();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());

  const { childFolders, childNotes } = useMemo(() => {
    const tree = buildNoteTree(notes, folders);
    if (tree.length === 0) {
      return { childFolders: [] as NoteTreeNode[], childNotes: [] as LocalNoteSummary[] };
    }
    const root = tree[0];
    if (root.path === "") {
      return { childFolders: root.folders, childNotes: root.notes };
    }
    return { childFolders: tree, childNotes: [] as LocalNoteSummary[] };
  }, [notes, folders]);

  const allSelectableIds = useMemo(() => notes.map((n) => n.id), [notes]);

  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setCollapsedPaths(new Set());
    }
  }, [open]);

  const toggleFolder = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleNote = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setManySelected = useCallback((ids: string[], selected: boolean) => {
    if (ids.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const selectAllNotes = useCallback(() => {
    setSelectedIds(new Set(allSelectableIds));
  }, [allSelectableIds]);

  const clearNoteSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleExport = useCallback(async () => {
    if (!db) {
      toast.error("Local database is not ready yet. Try again in a moment.");
      return;
    }
    try {
      const result = await exportNotesToZip({ db, noteIds: [...selectedIds] });
      if ("ok" in result && result.ok) {
        toast.success(`Exported to ${result.path}`);
        onOpenChange(false);
        return;
      }
      if ("canceled" in result && result.canceled) {
        onOpenChange(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [db, exportNotesToZip, onOpenChange, selectedIds]);

  const emptyTree = childFolders.length === 0 && childNotes.length === 0;
  const exportDisabled = selectedIds.size === 0 || exporting;
  const hasNotesToPick = allSelectableIds.length > 0;
  const allNotesSelected =
    hasNotesToPick && allSelectableIds.every((id) => selectedIds.has(id));

  const countLabel =
    selectedIds.size === 0
      ? "None selected"
      : selectedIds.size === 1
        ? "1 note selected"
        : `${selectedIds.size} notes selected`;

  const listPanelClass =
    "mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-black/25";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(76vh,540px)] w-[min(420px,calc(100vw-32px))] flex-col gap-0 overflow-hidden">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>Export notes</DialogTitle>
          <DialogDescription>
            Markdown files in a ZIP. Folder checkboxes select every note in that folder, including
            subfolders.
          </DialogDescription>
        </DialogHeader>

        {!emptyTree && hasNotesToPick ? (
          <div className={listPanelClass}>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] px-3 py-2.5">
              <span className="text-[0.72rem] tabular-nums text-muted">{countLabel}</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2.5 text-[0.72rem] text-muted hover:text-foreground"
                  disabled={allNotesSelected || exporting}
                  onClick={selectAllNotes}
                  aria-label="Select all notes"
                >
                  All
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2.5 text-[0.72rem] text-muted hover:text-foreground"
                  disabled={selectedIds.size === 0 || exporting}
                  onClick={clearNoteSelection}
                  aria-label="Clear selection"
                >
                  None
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <ExportTree
                folders={childFolders}
                notes={childNotes}
                depth={0}
                collapsedPaths={collapsedPaths}
                onToggleFolder={toggleFolder}
                selectedIds={selectedIds}
                onToggleNote={toggleNote}
                onSetManySelected={setManySelected}
              />
            </div>
          </div>
        ) : (
          <p className="m-0 mt-4 rounded-xl border border-dashed border-white/[0.1] px-4 py-8 text-center text-[0.82rem] text-muted">
            No notes to export.
          </p>
        )}

        <div className="mt-5 flex shrink-0 justify-end gap-2 border-t border-white/[0.08] pt-4">
          <Button type="button" variant="dialog-secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="dialog-primary"
            disabled={exportDisabled}
            onClick={() => void handleExport()}
          >
            {exporting ? "Exporting…" : "Export"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
