import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { showContextMenu } from "../lib/api";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "../lib/utils";
import type { DerivedTaskItem } from "../hooks/useChecklistItems";
import type { ChecklistDefinition } from "../hooks/useChecklists";

interface ChecklistViewProps {
  checklist: ChecklistDefinition | null;
  items: DerivedTaskItem[];
  loading?: boolean;
  onToggleItem: (item: DerivedTaskItem) => Promise<void>;
  onOpenNote: (noteId: string) => void;
}

export function ChecklistView({
  checklist,
  items,
  loading,
  onToggleItem,
  onOpenNote,
}: ChecklistViewProps) {
  const handleItemContextMenu = useCallback(
    async (e: React.MouseEvent, item: DerivedTaskItem) => {
      e.preventDefault();
      const selected = await showContextMenu([{ id: "open-note", label: "Open note" }]);
      if (selected === "open-note") onOpenNote(item.noteId);
    },
    [onOpenNote],
  );
  const [showChecked, setShowChecked] = useState(true);

  if (loading || !checklist) {
    return <div className="flex h-full min-h-0 flex-col" />;
  }

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-8 pt-6 pb-2">
        <h2 className="m-0 text-[1.15rem] font-semibold text-foreground">{checklist.name}</h2>
        <div className="m-0 mt-0.5 flex items-center gap-1.5 text-[0.8rem] text-faint">
          <span>{unchecked.length} remaining</span>
          {checked.length > 0 && (
            <>
              <span>·</span>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 text-[0.8rem] text-faint transition-colors hover:text-foreground"
                onClick={() => setShowChecked((v) => !v)}
              >
                {checked.length} done
                {showChecked ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            </>
          )}
        </div>
      </div>

      <ScrollArea className="note-scroll-area min-h-0 flex-1 [&_.ui-scroll-area__scrollbar--horizontal]:hidden [&_.ui-scroll-area__scrollbar--vertical]:hidden">
        <div className="px-8 pb-8">
          {items.length === 0 ? (
            <p className="py-8 text-center text-[0.85rem] text-faint">
              No task items found in matching notes
            </p>
          ) : (
            <>
              <AnimatePresence initial={false}>
                {unchecked.map((item) => (
                  <ChecklistItemRow
                    key={`${item.noteId}-${item.taskListIndex}-${item.taskItemIndex}`}
                    item={item}
                    onToggle={() => void onToggleItem(item)}
                    onOpenNote={() => onOpenNote(item.noteId)}
                    onContextMenu={(e) => void handleItemContextMenu(e, item)}
                  />
                ))}
              </AnimatePresence>

              {showChecked && unchecked.length > 0 && checked.length > 0 && (
                <div className="my-3 h-px bg-white/[0.06]" />
              )}

              <AnimatePresence initial={false}>
                {showChecked &&
                  checked.map((item) => (
                    <ChecklistItemRow
                      key={`${item.noteId}-${item.taskListIndex}-${item.taskItemIndex}`}
                      item={item}
                      onToggle={() => void onToggleItem(item)}
                      onOpenNote={() => onOpenNote(item.noteId)}
                      onContextMenu={(e) => void handleItemContextMenu(e, item)}
                    />
                  ))}
              </AnimatePresence>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ChecklistItemRow({
  item,
  onToggle,
  onOpenNote,
  onContextMenu,
}: {
  item: DerivedTaskItem;
  onToggle: () => void;
  onOpenNote: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: item.checked ? 20 : -20, transition: { duration: 0.2 } }}
      transition={{ layout: { duration: 0.25 }, opacity: { duration: 0.2 }, y: { duration: 0.2 } }}
      className={cn(
        "flex items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.03]",
        item.checked && "opacity-50",
      )}
      onContextMenu={onContextMenu}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-white"
        checked={item.checked}
        onChange={onToggle}
      />
      <div className="min-w-0 flex-1 gap-0">
        <div
          className={cn(
            "text-[0.85rem] leading-snug text-foreground",
            item.checked && "line-through text-muted",
          )}
        >
          {item.text}
        </div>
        <button
          type="button"
          className="mt-o cursor-pointer border-0 bg-transparent p-0 text-[0.72rem] text-faint transition-colors hover:text-blue-400 hover:underline"
          onClick={onOpenNote}
        >
          {item.notePath}
        </button>
      </div>
    </motion.div>
  );
}
