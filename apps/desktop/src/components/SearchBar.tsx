import { forwardRef } from "react";

export interface SearchBarProps {
  open: boolean;
  closing: boolean;
  query: string;
  index: number;
  count: number;
  onQueryChange: (query: string) => void;
  onNavigate: (direction: 1 | -1) => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export const SearchBar = forwardRef<unknown, SearchBarProps>(function SearchBar(
  { open, closing, query, index, count, onQueryChange, onNavigate, onClose, inputRef },
  _ref
) {
  if (!open) return null;

  return (
    <div className={`search-bar${closing ? " is-closing" : ""}`}>
      <input
        ref={inputRef}
        className="search-bar__input"
        type="text"
        placeholder="Find in note…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter") {
            e.preventDefault();
            onNavigate(e.shiftKey ? -1 : 1);
          }
        }}
      />
      {query && (
        <span className="search-bar__count">
          {count > 0 ? `${index + 1} of ${count}` : "No results"}
        </span>
      )}
      <button
        type="button"
        className="search-bar__nav"
        onClick={() => onNavigate(-1)}
        disabled={count === 0}
        aria-label="Previous match"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
      <button
        type="button"
        className="search-bar__nav"
        onClick={() => onNavigate(1)}
        disabled={count === 0}
        aria-label="Next match"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <button type="button" className="search-bar__close" onClick={onClose} aria-label="Close search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
});
