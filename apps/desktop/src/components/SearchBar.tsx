import { forwardRef, useState } from "react";
import { cn } from "../lib/utils";

export interface SearchBarProps {
  open: boolean;
  closing: boolean;
  query: string;
  index: number;
  count: number;
  onQueryChange: (query: string) => void;
  onNavigate: (direction: 1 | -1) => void;
  onClose: () => void;
  onReplace: (replacement: string) => void;
  onReplaceAll: (replacement: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

const searchInput =
  "min-w-0 flex-1 rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[0.88rem] text-foreground outline-none transition-colors placeholder:text-faint focus:bg-white/10";

const iconBtn =
  "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-transparent text-muted transition-[background-color,color] hover:bg-white/[0.08] hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted";

export const SearchBar = forwardRef<unknown, SearchBarProps>(function SearchBar(
  {
    open,
    closing,
    query,
    index,
    count,
    onQueryChange,
    onNavigate,
    onClose,
    onReplace,
    onReplaceAll,
    inputRef,
  },
  _ref,
) {
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceText, setReplaceText] = useState("");

  if (!open) return null;

  return (
    <div
      className={cn(
        "absolute top-1 right-6 z-20 flex items-stretch rounded-xl border border-border bg-panel-elevated px-2 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.3)]",
        !closing && "motion-safe:animate-[search-fade-in_160ms_ease-out] motion-reduce:opacity-100",
        closing &&
          "motion-safe:animate-[search-fade-out_120ms_ease-in_forwards] motion-reduce:animate-none",
      )}
    >
      <div className="flex w-80 min-w-0 flex-col gap-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="inline-flex h-7 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md bg-transparent text-muted transition-[background-color,color] hover:bg-white/[0.08] hover:text-foreground"
            onClick={() => setReplaceOpen((prev) => !prev)}
            aria-label={replaceOpen ? "Hide replace" : "Show replace"}
            title={replaceOpen ? "Hide replace" : "Show replace"}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: replaceOpen ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 120ms",
              }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <input
            ref={inputRef}
            className={searchInput}
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
            <span className="whitespace-nowrap px-1 text-[0.78rem] text-muted">
              {count > 0 ? `${index + 1} of ${count}` : "No results"}
            </span>
          )}
          <button
            type="button"
            className={iconBtn}
            onClick={() => onNavigate(-1)}
            disabled={count === 0}
            aria-label="Previous match"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
          <button
            type="button"
            className={iconBtn}
            onClick={() => onNavigate(1)}
            disabled={count === 0}
            aria-label="Next match"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <button type="button" className={iconBtn} onClick={onClose} aria-label="Close search">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {replaceOpen && (
          <div className="flex items-center gap-1 pl-6">
            <input
              className={searchInput}
              type="text"
              placeholder="Replace with…"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  onReplace(replaceText);
                }
              }}
            />
            <button
              type="button"
              className={iconBtn}
              onClick={() => onReplace(replaceText)}
              disabled={count === 0}
              aria-label="Replace"
              title="Replace"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
            <button
              type="button"
              className={iconBtn}
              onClick={() => onReplaceAll(replaceText)}
              disabled={count === 0}
              aria-label="Replace all"
              title="Replace all"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 4H6" />
                <path d="M18 10H6" />
                <path d="M12 16h9" />
                <path d="M7.5 12.5a1.5 1.5 0 0 1 2.1 2.1L4 20l-1 .5.5-1 5.6-5.6z" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
