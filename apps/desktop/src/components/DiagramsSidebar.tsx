import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useAppStore } from "../stores/app-store";
import { useDiagrams } from "../hooks/useDiagrams";
import { cn } from "../lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { ScrollArea } from "./ui/scroll-area";
import { DeleteDiagramDialog } from "./DeleteDiagramDialog";
import { CreateDiagramDialog } from "./CreateDiagramDialog";
import { RenameFolderDialog } from "./RenameFolderDialog";
import { showContextMenu } from "../lib/api";
import type { ContextMenuItem as NativeMenuItem } from "../lib/api";

export function DiagramsSidebar() {
  const { diagrams, loading, create, remove, rename } = useDiagrams();
  const selectedDiagramId = useAppStore((s) => s.selectedDiagramId);
  const setSelectedDiagramId = useAppStore((s) => s.setSelectedDiagramId);
  const setMainPanelMode = useAppStore((s) => s.setMainPanelMode);
  const bumpDiagramRefreshSignal = useAppStore((s) => s.bumpDiagramRefreshSignal);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [renameTarget, setRenameTarget] = useState<{ id: string; originalTitle: string } | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");

  function openCreate() {
    setCreateName("");
    setCreateOpen(true);
  }

  async function confirmCreate() {
    const title = createName.trim();
    if (!title) return;
    setCreateOpen(false);
    setCreateName("");
    const d = await create(title);
    setSelectedDiagramId(d.id);
    setMainPanelMode("diagrams");
  }

  function handleSelect(id: string) {
    setSelectedDiagramId(id);
    setMainPanelMode("diagrams");
  }

  function requestDelete(e: React.MouseEvent, id: string, title: string) {
    e.stopPropagation();
    setPendingDelete({ id, title });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await remove(id);
    if (selectedDiagramId === id) setSelectedDiagramId("");
  }

  async function handleRowContextMenu(
    e: React.MouseEvent,
    d: { id: string; title: string | null },
  ) {
    e.preventDefault();
    e.stopPropagation();
    const title = d.title || "Untitled";
    const items: NativeMenuItem[] = [
      { id: "rename", label: "Rename" },
      { type: "separator", id: "sep-rename", label: "" },
      { id: "delete", label: "Delete Diagram" },
    ];
    const selected = await showContextMenu(items);
    if (selected === "rename") {
      setRenameTarget({ id: d.id, originalTitle: title });
      setRenameValue(title);
    } else if (selected === "delete") {
      setPendingDelete({ id: d.id, title });
    }
  }

  async function confirmRename() {
    if (!renameTarget) return;
    const next = renameValue.trim();
    if (!next || next === renameTarget.originalTitle) {
      setRenameTarget(null);
      return;
    }
    const id = renameTarget.id;
    setRenameTarget(null);
    await rename(id, next);
    if (selectedDiagramId === id) bumpDiagramRefreshSignal();
  }

  return (
    <>
      <div className="mb-1.5 flex w-full max-w-full min-w-0 shrink-0 items-center justify-between text-[0.88rem] text-muted tracking-wide">
        <span
          className="text-[0.9rem] font-normal tracking-wide text-foreground"
          style={{ userSelect: "none" }}
        >
          Diagrams
        </span>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
                aria-label="New diagram"
              >
                <Plus size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New diagram</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <ScrollArea
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col",
          "[&_.ui-scroll-area__viewport]:overflow-x-hidden!",
          "[&_.ui-scroll-area__scrollbar--horizontal]:hidden",
          "[&_.ui-scroll-area__scrollbar--vertical]:hidden",
        )}
      >
        <div className="grid min-h-full min-w-0 max-w-full gap-0.5 box-border pr-2">
          {loading ? (
            <div className="flex w-full justify-center px-4 py-3 text-[0.82rem] text-faint">
              Loading…
            </div>
          ) : diagrams.length === 0 ? (
            <div className="flex w-full justify-center px-4 py-3 text-[0.82rem] text-faint">
              No diagrams yet
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {diagrams.map((d) => (
                <li
                  key={d.id}
                  onClick={() => handleSelect(d.id)}
                  onContextMenu={(e) => void handleRowContextMenu(e, d)}
                  className={cn(
                    "group flex cursor-pointer items-center justify-between rounded px-2 py-1 text-[0.88rem] hover:bg-white/[0.06]",
                    d.id === selectedDiagramId && "bg-white/[0.08]",
                  )}
                >
                  <span className="truncate text-foreground">{d.title || "Untitled"}</span>
                  <button
                    type="button"
                    onClick={(e) => requestDelete(e, d.id, d.title || "Untitled")}
                    className="hidden size-[20px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground group-hover:inline-flex"
                    aria-label="Delete diagram"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>
      <CreateDiagramDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        value={createName}
        onValueChange={setCreateName}
        onConfirm={confirmCreate}
      />
      <DeleteDiagramDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        diagramTitle={pendingDelete?.title ?? null}
        onConfirm={confirmDelete}
      />
      <RenameFolderDialog
        open={renameTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRenameTarget(null);
        }}
        value={renameValue}
        onValueChange={setRenameValue}
        onConfirm={confirmRename}
        title="Rename diagram"
        description="Enter a new name for this diagram."
        confirmLabel="Rename"
        disableConfirm={renameValue.trim().length === 0}
        selectAllOnOpen
      />
    </>
  );
}
