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

function ExportTree({
  folders,
  notes,
  depth,
  collapsedPaths,
  onToggleFolder,
  selectedIds,
  onToggleNote,
}: {
  folders: NoteTreeNode[];
  notes: LocalNoteSummary[];
  depth: number;
  collapsedPaths: Set<string>;
  onToggleFolder: (path: string) => void;
  selectedIds: Set<string>;
  onToggleNote: (id: string) => void;
}) {
  const pad = 10 + depth * 14;

  return (
    <div className="flex flex-col">
      {folders.map((folder) => {
        const collapsed = collapsedPaths.has(folder.path);
        return (
          <div key={folder.path} className="border-b border-white/[0.04] last:border-b-0">
            <button
              type="button"
              className={cn(
                "flex w-full cursor-pointer items-center gap-1.5 py-1.5 text-left text-[0.84rem] text-foreground hover:bg-white/[0.04]",
              )}
              style={{ paddingLeft: pad }}
              aria-expanded={!collapsed}
              onClick={() => onToggleFolder(folder.path)}
            >
              <ChevronRight
                className={cn(
                  "size-4 shrink-0 text-faint transition-transform duration-150",
                  !collapsed && "rotate-90",
                )}
                aria-hidden
              />
              <span className="min-w-0 truncate font-medium">{folder.name}</span>
            </button>
            {!collapsed ? (
              <ExportTree
                folders={folder.folders}
                notes={folder.notes}
                depth={depth + 1}
                collapsedPaths={collapsedPaths}
                onToggleFolder={onToggleFolder}
                selectedIds={selectedIds}
                onToggleNote={onToggleNote}
              />
            ) : null}
          </div>
        );
      })}
      {notes.map((note) => (
        <label
          key={note.id}
          className="flex cursor-pointer items-center gap-2 border-b border-white/[0.04] py-1.5 text-[0.84rem] last:border-b-0 hover:bg-white/[0.03]"
          style={{ paddingLeft: pad }}
        >
          <Checkbox
            checked={selectedIds.has(note.id)}
            onCheckedChange={() => onToggleNote(note.id)}
            className="shrink-0"
          />
          <span className="min-w-0 truncate text-foreground">{noteLabel(note)}</span>
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

  const selectAllNotes = useCallback(() => {
    setSelectedIds(new Set(allSelectableIds));
  }, [allSelectableIds]);

  const clearNoteSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  async function handleExport() {
    if (!db) {
      toast.error("Local database is not ready yet. Try again in a moment.");
      return;
    }
    const noteIds = [...selectedIds];
    try {
      const result = await exportNotesToZip({ db, noteIds });
      if ("ok" in result && result.ok) {
        toast.success(`Exported to ${result.path}`);
        onOpenChange(false);
        return;
      }
      if ("canceled" in result && result.canceled) {
        onOpenChange(false);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(message);
    }
  }

  const emptyTree = childFolders.length === 0 && childNotes.length === 0;
  const exportDisabled = selectedIds.size === 0 || exporting;
  const hasNotesToPick = allSelectableIds.length > 0;
  const allNotesSelected =
    hasNotesToPick && allSelectableIds.every((id) => selectedIds.has(id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(72vh,520px)] w-[min(440px,calc(100vw-32px))] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Export notes</DialogTitle>
          <DialogDescription>
            Choose notes to bundle as Markdown in a ZIP file. Attachments are inlined where
            possible.
          </DialogDescription>
        </DialogHeader>

        {!emptyTree && hasNotesToPick ? (
          <div className="mt-2 flex shrink-0 items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[0.78rem] text-muted hover:text-foreground"
              disabled={allNotesSelected || exporting}
              onClick={selectAllNotes}
            >
              Select all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[0.78rem] text-muted hover:text-foreground"
              disabled={selectedIds.size === 0 || exporting}
              onClick={clearNoteSelection}
            >
              Clear
            </Button>
          </div>
        ) : null}

        <div
          className="mt-1 min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-white/[0.02] py-1"
          style={{ maxHeight: "min(42vh,320px)" }}
        >
          {emptyTree ? (
            <p className="m-0 px-3 py-6 text-center text-[0.82rem] text-faint">No notes to export.</p>
          ) : (
            <ExportTree
              folders={childFolders}
              notes={childNotes}
              depth={0}
              collapsedPaths={collapsedPaths}
              onToggleFolder={toggleFolder}
              selectedIds={selectedIds}
              onToggleNote={toggleNote}
            />
          )}
        </div>

        <div className="mt-4 flex shrink-0 justify-end gap-2">
          <Button type="button" variant="dialog-secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
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
