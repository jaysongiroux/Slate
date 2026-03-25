import { useEffect, useRef, useState } from "react";
import type { LocalNoteSummary } from "@slate/shared";

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
    <div className="command-bar-backdrop" onClick={onClose}>
      <div className="command-bar" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <input
          ref={inputRef}
          className="command-bar__input"
          type="text"
          placeholder="Search notes..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="command-bar__list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="command-bar__empty">No matching notes</div>
          ) : (
            filtered.map((note, i) => {
              const folder = folderFromPath(note.path);
              const snippet = query.trim() ? getSnippet(note.plainText ?? "", query.trim()) : null;
              return (
                <button
                  key={note.id}
                  type="button"
                  className={`command-bar__item${i === selectedIndex ? " is-selected" : ""}`}
                  onMouseEnter={() => setSelectedIndex(i)}
                  onClick={() => onSelect(note.id)}
                >
                  <div className="command-bar__item-left">
                    <span className="command-bar__item-title">{note.title}</span>
                    {snippet && <span className="command-bar__item-snippet">{snippet}</span>}
                  </div>
                  {folder && <span className="command-bar__item-path">{folder}</span>}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
