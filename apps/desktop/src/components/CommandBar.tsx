import { useEffect, useRef, useState } from "react";
import type { LocalNoteSummary } from "@slate/shared";
import { cn } from "../lib/utils";

interface CommandBarProps {
  open: boolean;
  notes: LocalNoteSummary[];
  onSelect: (noteId: string) => void;
  onClose: () => void;
}

export function CommandBar({ open, notes, onSelect, onClose }: CommandBarProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? notes.filter((note) => {
        const q = query.toLowerCase();
        return (
          note.title.toLowerCase().includes(q) ||
          note.path.toLowerCase().includes(q) ||
          (note.plainText ?? "").toLowerCase().includes(q)
        );
      })
    : notes;

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1 < filtered.length ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 >= 0 ? i - 1 : Math.max(filtered.length - 1, 0)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const note = filtered[selectedIndex];
      if (note) onSelect(note.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  function folderFromPath(p: string): string {
    const idx = p.lastIndexOf("/");
    return idx > 0 ? p.slice(0, idx) : "";
  }

  function getSnippet(text: string, q: string): string | null {
    if (!q) return null;
    const lower = text.toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx === -1) return null;
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + q.length + 80);
    let snippet = text.slice(start, end).replace(/\n/g, " ");
    if (start > 0) snippet = "\u2026" + snippet;
    if (end < text.length) snippet = snippet + "\u2026";
    return snippet;
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/45 backdrop-blur-[4px]",
        "animate-[command-bar-fade-in_120ms_ease-out]",
      )}
      onClick={onClose}
    >
      <div
        className="absolute left-1/2 top-[14%] w-full max-w-[min(520px,calc(100vw-48px))] -translate-x-1/2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div
          className={cn(
            "flex flex-col overflow-hidden rounded-2xl border border-border bg-panel-elevated shadow-[0_24px_60px_rgba(0,0,0,0.5)]",
            "animate-[command-bar-panel-in_160ms_ease-out]",
          )}
        >
          <input
            ref={inputRef}
            className={cn(
              "w-full border-0 border-b border-border bg-transparent px-[18px] py-3.5 text-base text-foreground outline-none",
              "placeholder:text-faint",
            )}
            type="text"
            placeholder="Search notes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div
            className={cn(
              "max-h-[340px] overflow-y-auto p-1.5 [scrollbar-width:none]",
              "[&::-webkit-scrollbar]:hidden",
            )}
            ref={listRef}
          >
            {filtered.length === 0 ? (
              <div className="p-[18px] text-center text-[0.88rem] text-faint">No matching notes</div>
            ) : (
              filtered.map((note, i) => {
                const folder = folderFromPath(note.path);
                const snippet = query.trim() ? getSnippet(note.plainText ?? "", query.trim()) : null;
                return (
                  <button
                    key={note.id}
                    type="button"
                    className={cn(
                      "flex w-full cursor-pointer items-start justify-between gap-3 rounded-[10px] bg-transparent px-3 py-2.5 text-left hover:bg-white/[0.08]",
                      i === selectedIndex && "bg-white/[0.08]",
                    )}
                    onMouseEnter={() => setSelectedIndex(i)}
                    onClick={() => onSelect(note.id)}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[0.92rem] font-medium text-foreground">{note.title}</span>
                      {snippet ? (
                        <span className="truncate text-[0.78rem] leading-snug text-faint">{snippet}</span>
                      ) : null}
                    </div>
                    {folder ? (
                      <span className="shrink-0 whitespace-nowrap text-[0.78rem] text-faint">{folder}</span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
