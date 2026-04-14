import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { showContextMenu } from "../lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "../lib/utils";
import type { ChecklistDefinition } from "../hooks/useChecklists";

interface ChecklistsSidebarProps {
  checklists: ChecklistDefinition[];
  selectedChecklistId: string | null;
  onSelectChecklist: (id: string) => void;
  onAddChecklist: (name: string, patterns: string[]) => Promise<ChecklistDefinition>;
  onUpdateChecklist: (
    id: string,
    updates: Partial<Pick<ChecklistDefinition, "name" | "patterns">>,
  ) => Promise<void>;
  onDeleteChecklist: (id: string) => Promise<void>;
}

export function ChecklistsSidebar({
  checklists,
  selectedChecklistId,
  onSelectChecklist,
  onAddChecklist,
  onUpdateChecklist,
  onDeleteChecklist,
}: ChecklistsSidebarProps) {
  const patternSuggestions = useMemo(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    return [
      { label: "All notes", pattern: ".*" },
      { label: "All daily notes", pattern: ".*\\d{4}-\\d{2}-\\d{2}$" },
      { label: `This month (${yyyy}-${mm})`, pattern: `.*${yyyy}-${mm}-\\d{2}$` },
      { label: `This year (${yyyy})`, pattern: `.*${yyyy}-\\d{2}-\\d{2}$` },
    ];
  }, []);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [patternsValue, setPatternsValue] = useState("");

  useEffect(() => {
    if (!dialogOpen) {
      setEditingId(null);
      setNameValue("");
      setPatternsValue("");
    }
  }, [dialogOpen]);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setNameValue("");
    setPatternsValue("");
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((checklist: ChecklistDefinition) => {
    setEditingId(checklist.id);
    setNameValue(checklist.name);
    setPatternsValue(checklist.patterns.join("\n"));
    setDialogOpen(true);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const name = nameValue.trim();
      const patterns = patternsValue
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean);
      if (!name || patterns.length === 0) return;

      if (editingId) {
        await onUpdateChecklist(editingId, { name, patterns });
      } else {
        const created = await onAddChecklist(name, patterns);
        onSelectChecklist(created.id);
      }
      setDialogOpen(false);
    },
    [editingId, nameValue, patternsValue, onAddChecklist, onUpdateChecklist, onSelectChecklist],
  );

  const handleContextMenu = useCallback(
    async (e: React.MouseEvent, checklist: ChecklistDefinition) => {
      e.preventDefault();
      const selected = await showContextMenu([
        { id: "edit", label: "Edit" },
        { type: "separator", id: "sep", label: "" },
        { id: "delete", label: "Delete" },
      ]);
      if (selected === "edit") openEdit(checklist);
      else if (selected === "delete") await onDeleteChecklist(checklist.id);
    },
    [openEdit, onDeleteChecklist],
  );

  return (
    <>
      <div className="mb-1.5 flex w-full max-w-full min-w-0 shrink-0 items-center justify-between text-[0.88rem] text-muted tracking-wide">
        <span
          className="text-[0.9rem] font-normal tracking-wide text-foreground"
          style={{ userSelect: "none" }}
        >
          Checklists
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
              aria-label="Create new checklist"
              onClick={openCreate}
            >
              <Plus size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New checklist</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea
        className={cn(
          "note-scroll-area relative flex min-h-0 min-w-0 flex-1 flex-col",
          "[&_.ui-scroll-area__viewport]:overflow-x-hidden!",
          "[&_.ui-scroll-area__scrollbar--horizontal]:hidden",
          "[&_.ui-scroll-area__scrollbar--vertical]:hidden",
        )}
      >
        <div className="grid min-h-full min-w-0 max-w-full gap-1 box-border pr-2">
          {checklists.length === 0 ? (
            <div className="flex w-full justify-center px-4 py-3 text-[0.82rem] text-faint">
              No checklists yet
            </div>
          ) : (
            checklists.map((checklist) => (
              <button
                key={checklist.id}
                type="button"
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-[0.84rem] transition-colors",
                  selectedChecklistId === checklist.id
                    ? "bg-white/[0.07] text-foreground"
                    : "text-muted hover:bg-white/[0.04] hover:text-foreground",
                )}
                onClick={() => onSelectChecklist(checklist.id)}
                onContextMenu={(e) => void handleContextMenu(e, checklist)}
              >
                <span className="truncate">{checklist.name}</span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
            <DialogHeader className="mb-0">
              <DialogTitle>{editingId ? "Edit Checklist" : "New Checklist"}</DialogTitle>
              <DialogDescription>
                {editingId
                  ? "Update the name or regex patterns for this checklist."
                  : "Create a checklist that aggregates tasks from notes matching regex patterns."}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1">
              <label className="text-[0.8rem] text-muted" htmlFor="checklist-name">
                Name
              </label>
              <Input
                id="checklist-name"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                placeholder="Daily Tasks"
                autoFocus
                variant="bordered"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[0.8rem] text-muted" htmlFor="checklist-patterns">
                Patterns (one regex per line)
              </label>
              <textarea
                id="checklist-patterns"
                className="w-full rounded-[10px] border border-border bg-white/[0.04] px-3 py-2.5 text-[0.9rem] text-foreground outline-none transition-[border-color,box-shadow] duration-150 ease-out focus:border-white/20 resize-none"
                placeholder={"journal/2026-.*\nprojects/.*"}
                rows={3}
                value={patternsValue}
                onChange={(e) => setPatternsValue(e.target.value)}
              />
              <div className="mt-1 flex flex-wrap gap-1.5">
                {patternSuggestions.map((s) => (
                  <button
                    key={s.pattern}
                    type="button"
                    className="cursor-pointer rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[0.72rem] text-faint transition-colors hover:bg-white/[0.08] hover:text-foreground"
                    onClick={() =>
                      setPatternsValue((prev) => {
                        const trimmed = prev.trimEnd();
                        return trimmed ? `${trimmed}\n${s.pattern}` : s.pattern;
                      })
                    }
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="dialog-secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="dialog-primary"
                type="submit"
                disabled={!nameValue.trim() || !patternsValue.trim()}
              >
                {editingId ? "Save" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
