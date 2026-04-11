import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  const pad = 12 + depth * 12;

  return (
    <div className="flex flex-col">
      {folders.map((folder) => {
        const collapsed = collapsedPaths.has(folder.path);
        return (
          <div key={folder.path}>
            <button
              type="button"
              className={cn(
                "flex w-full cursor-pointer items-center gap-1 py-2 text-left text-[0.8rem] text-muted transition-colors hover:text-foreground/90",
              )}
              style={{ paddingLeft: pad }}
              aria-expanded={!collapsed}
              onClick={() => onToggleFolder(folder.path)}
            >
              <ChevronRight
                className={cn(
                  "size-3 shrink-0 opacity-50 transition-transform duration-200 ease-out",
                  !collapsed && "rotate-90",
                )}
                aria-hidden
              />
              <span className="min-w-0 truncate font-medium tracking-tight">{folder.name}</span>
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
          className={cn(
            "flex cursor-pointer items-center gap-2.5 rounded-lg py-2 pr-2 text-[0.8rem] transition-colors",
            "text-foreground/90 hover:bg-white/[0.04]",
          )}
          style={{ paddingLeft: pad }}
        >
          <Checkbox
            checked={selectedIds.has(note.id)}
            onCheckedChange={() => onToggleNote(note.id)}
            className="size-[15px] shrink-0 rounded-[3px] border-white/20 [&_svg]:size-3"
          />
          <span className="min-w-0 truncate tracking-tight">{noteLabel(note)}</span>
        </label>
      ))}
    </div>
  );
}

function ToolbarLink({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "cursor-pointer border-none bg-transparent p-0 text-[0.72rem] font-medium tracking-wide text-faint transition-colors",
        "hover:text-foreground/80",
        "disabled:pointer-events-none disabled:opacity-35",
      )}
    >
      {children}
    </button>
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

  const selectedLabel =
    selectedIds.size === 0
      ? "None selected"
      : selectedIds.size === 1
        ? "1 note"
        : `${selectedIds.size} notes`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(78vh,560px)] w-[min(400px,calc(100vw-32px))] flex-col gap-0 overflow-hidden pb-6">
        <DialogHeader className="mb-0 shrink-0 space-y-1 pr-7">
          <DialogTitle className="text-[1.05rem] font-semibold tracking-tight">Export notes</DialogTitle>
          <DialogDescription className="text-[0.84rem] leading-relaxed text-muted">
            Markdown in a ZIP. Images are inlined as data URLs.
          </DialogDescription>
        </DialogHeader>

        {!emptyTree && hasNotesToPick ? (
          <div className="mt-5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl ring-1 ring-white/[0.06]">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.05] px-3.5 py-2.5">
              <span className="text-[0.72rem] tabular-nums tracking-wide text-faint">{selectedLabel}</span>
              <div className="flex items-center gap-2.5">
                <ToolbarLink disabled={allNotesSelected || exporting} onClick={selectAllNotes}>
                  All
                </ToolbarLink>
                <span className="select-none text-[0.65rem] text-white/15" aria-hidden>
                  ·
                </span>
                <ToolbarLink disabled={selectedIds.size === 0 || exporting} onClick={clearNoteSelection}>
                  None
                </ToolbarLink>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-1">
              <ExportTree
                folders={childFolders}
                notes={childNotes}
                depth={0}
                collapsedPaths={collapsedPaths}
                onToggleFolder={toggleFolder}
                selectedIds={selectedIds}
                onToggleNote={toggleNote}
              />
            </div>
          </div>
        ) : (
          <p className="m-0 mt-5 rounded-2xl px-4 py-10 text-center text-[0.8rem] text-faint ring-1 ring-white/[0.05]">
            No notes to export.
          </p>
        )}

        <div className="mt-6 flex shrink-0 justify-end gap-2 border-t border-white/[0.05] pt-5">
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
