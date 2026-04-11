import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LocalNoteSummary } from "@slate/shared";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useDatabase } from "../db/DatabaseProvider";
import { useMarkdownExport } from "../hooks/useMarkdownExport";
import { basename, buildNoteTree, type NoteTreeNode } from "../lib/noteTree";
import { cn } from "../lib/utils";
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
  const pad = 4 + depth * 16;

  return (
    <div className="flex flex-col">
      {folders.map((folder) => {
        const collapsed = collapsedPaths.has(folder.path);
        return (
          <div key={folder.path}>
            <button
              type="button"
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 py-2.5 text-left text-[0.8rem] text-faint transition-colors hover:text-muted",
              )}
              style={{ paddingLeft: pad }}
              aria-expanded={!collapsed}
              onClick={() => onToggleFolder(folder.path)}
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-white/25 transition-transform duration-200 ease-out",
                  !collapsed && "rotate-90 text-white/40",
                )}
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="min-w-0 truncate font-normal">{folder.name}</span>
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
      {notes.map((note) => {
        const selected = selectedIds.has(note.id);
        return (
          <label
            key={note.id}
            className={cn(
              "flex cursor-pointer items-center gap-3 py-2.5 pr-1 text-[0.82rem] transition-[background-color,color] duration-150",
              selected ? "bg-white/[0.07] text-foreground" : "text-foreground/85 hover:bg-white/[0.03]",
            )}
            style={{ paddingLeft: pad }}
          >
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggleNote(note.id)}
              className="size-4 shrink-0 rounded border-white/15 data-[state=checked]:border-white data-[state=checked]:bg-white data-[state=checked]:text-black"
            />
            <span className="min-w-0 truncate font-light">{noteLabel(note)}</span>
          </label>
        );
      })}
    </div>
  );
}

function TextAction({
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
        "border-none bg-transparent p-0 text-[0.78rem] text-muted underline decoration-white/15 decoration-1 underline-offset-[5px] transition-colors",
        "hover:text-foreground hover:decoration-white/35",
        "disabled:pointer-events-none disabled:opacity-30",
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

  const exportLabel =
    exporting ? "Preparing…" : selectedIds.size === 0 ? "Select notes" : `Download ZIP (${selectedIds.size})`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(82vh,620px)] w-[min(460px,calc(100vw-28px))] flex-col gap-0 overflow-hidden px-6 pb-7 pt-5">
        <DialogHeader className="mb-0 shrink-0 space-y-3 pr-8">
          <p className="m-0 text-[0.62rem] font-medium uppercase tracking-[0.22em] text-faint">
            Markdown archive
          </p>
          <DialogTitle className="m-0 text-[1.45rem] font-light leading-none tracking-tight text-foreground">
            Export
          </DialogTitle>
          {!emptyTree && hasNotesToPick ? (
            <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3 border-b border-white/[0.08] pb-4">
              <DialogDescription className="m-0 max-w-[min(100%,300px)] text-[0.8rem] font-light leading-snug text-muted">
                One ZIP file. Images become data URLs inside the Markdown.
              </DialogDescription>
              <div className="flex shrink-0 items-center gap-3.5 pt-0.5">
                <TextAction disabled={allNotesSelected || exporting} onClick={selectAllNotes}>
                  Select all
                </TextAction>
                <TextAction disabled={selectedIds.size === 0 || exporting} onClick={clearNoteSelection}>
                  Clear
                </TextAction>
              </div>
            </div>
          ) : (
            <DialogDescription className="sr-only">
              Choose notes to export as a ZIP of Markdown files.
            </DialogDescription>
          )}
        </DialogHeader>

        {!emptyTree && hasNotesToPick ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
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
        ) : (
          <p className="m-0 mt-6 border-b border-white/[0.06] pb-10 text-center text-[0.82rem] font-light text-faint">
            Nothing here to export yet.
          </p>
        )}

        <div className="mt-6 flex shrink-0 flex-col gap-3">
          <button
            type="button"
            disabled={exportDisabled}
            onClick={() => void handleExport()}
            className={cn(
              "w-full rounded-xl border border-transparent py-3 text-[0.88rem] font-medium tracking-tight transition-[opacity,transform,background-color]",
              exportDisabled
                ? "cursor-not-allowed bg-white/[0.08] text-white/35"
                : "cursor-pointer bg-white text-black hover:bg-white/92 active:scale-[0.99]",
            )}
          >
            {exportLabel}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="border-none bg-transparent py-1 text-center text-[0.8rem] font-light text-muted transition-colors hover:text-foreground/80"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
