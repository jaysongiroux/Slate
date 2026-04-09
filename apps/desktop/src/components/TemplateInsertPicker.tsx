import { useEffect, useRef, useState } from "react";
import type { LocalNoteSummary } from "@slate/shared";
import { cn } from "../lib/utils";

interface TemplateInsertPickerProps {
  open: boolean;
  templates: LocalNoteSummary[];
  loading: boolean;
  errorMessage: string;
  insertingTemplateId?: string | null;
  onSelect: (template: LocalNoteSummary) => void;
  onClose: () => void;
}

export function TemplateInsertPicker({
  open,
  templates,
  loading,
  errorMessage,
  insertingTemplateId = null,
  onSelect,
  onClose,
}: TemplateInsertPickerProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? templates.filter((template) => {
        const q = query.toLowerCase();
        return template.title.toLowerCase().includes(q) || template.path.toLowerCase().includes(q);
      })
    : templates;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    setTimeout(() => inputRef.current?.focus(), 0);
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
      const template = filtered[selectedIndex];
      if (template) onSelect(template);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  function folderFromPath(path: string): string {
    const idx = path.lastIndexOf("/");
    return idx > 0 ? path.slice(0, idx) : "";
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
        className="absolute left-1/2 top-[18%] w-full max-w-[min(520px,calc(100vw-48px))] -translate-x-1/2"
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
            placeholder="Search templates..."
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
            {loading ? (
              <div className="p-[18px] text-center text-[0.88rem] text-faint">
                Loading templates...
              </div>
            ) : errorMessage ? (
              <div className="p-[18px] text-center text-[0.88rem] text-red-300">{errorMessage}</div>
            ) : filtered.length === 0 ? (
              <div className="p-[18px] text-center text-[0.88rem] text-faint">
                No matching templates
              </div>
            ) : (
              filtered.map((template, i) => {
                const folder = folderFromPath(template.path);
                const isInserting = insertingTemplateId === template.id;

                return (
                  <button
                    key={template.id}
                    type="button"
                    className={cn(
                      "flex w-full cursor-pointer items-start justify-between gap-3 rounded-[10px] bg-transparent px-3 py-2.5 text-left hover:bg-white/[0.08]",
                      i === selectedIndex && "bg-white/[0.08]",
                      isInserting && "opacity-60",
                    )}
                    onMouseEnter={() => setSelectedIndex(i)}
                    onClick={() => onSelect(template)}
                    disabled={Boolean(insertingTemplateId)}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[0.92rem] font-medium text-foreground">
                        {template.title}
                      </span>
                      <span className="truncate text-[0.78rem] leading-snug text-faint">
                        {template.path}
                      </span>
                    </div>
                    {folder ? (
                      <span className="shrink-0 whitespace-nowrap text-[0.78rem] text-faint">
                        {folder}
                      </span>
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
