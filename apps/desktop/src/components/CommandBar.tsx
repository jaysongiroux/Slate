import { useEffect, useRef, useState } from "react";
import type { LocalNoteSummary } from "@slate/shared/index";

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
        return note.title.toLowerCase().includes(q) || note.path.toLowerCase().includes(q);
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
              return (
                <button
                  key={note.id}
                  type="button"
                  className={`command-bar__item${i === selectedIndex ? " is-selected" : ""}`}
                  onMouseEnter={() => setSelectedIndex(i)}
                  onClick={() => onSelect(note.id)}
                >
                  <span className="command-bar__item-title">{note.title}</span>
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
