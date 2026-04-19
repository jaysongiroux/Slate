import { useEffect, useRef, useState } from "react";
import type { LocalNoteSummary } from "@slate/shared";
import type { LinkwardenLink } from "@slate/shared";
import type { LucideIcon } from "lucide-react";
import { Link, Loader2 } from "lucide-react";
import { getLinkwardenInstances, getLinkwardenLinks, openExternal } from "../lib/api";
import { cn } from "../lib/utils";
import type { SidebarMode } from "./IconRail";

type CommandResult =
  | { kind: "tab"; id: SidebarMode; label: string; icon: LucideIcon }
  | { kind: "linkwarden-action"; query: string }
  | { kind: "note"; note: LocalNoteSummary };

interface CommandBarProps {
  open: boolean;
  notes: LocalNoteSummary[];
  onSelect: (noteId: string) => void;
  onClose: () => void;
  enabledTabs?: { id: SidebarMode; label: string; icon: LucideIcon }[];
  onTabSelect?: (mode: SidebarMode) => void;
  linkwardenEnabled?: boolean;
}

export function CommandBar({
  open,
  notes,
  onSelect,
  onClose,
  enabledTabs = [],
  onTabSelect,
  linkwardenEnabled = false,
}: CommandBarProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [phase, setPhase] = useState<"default" | "linkwarden">("default");
  const [linkwardenResults, setLinkwardenResults] = useState<
    (LinkwardenLink & { instanceName: string })[]
  >([]);
  const [linkwardenLoading, setLinkwardenLoading] = useState(false);
  const searchIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? notes.filter((note) => {
        const q = query.toLowerCase();
        return note.title.toLowerCase().includes(q) || note.path.toLowerCase().includes(q);
      })
    : notes;

  const filteredTabs = query.trim()
    ? enabledTabs.filter((tab) => tab.label.toLowerCase().includes(query.toLowerCase()))
    : [];

  const results: CommandResult[] = [
    ...filteredTabs.map((tab) => ({
      kind: "tab" as const,
      id: tab.id,
      label: tab.label,
      icon: tab.icon,
    })),
    ...(query.trim() && linkwardenEnabled
      ? [{ kind: "linkwarden-action" as const, query: query.trim() }]
      : []),
    ...filtered.map((note) => ({ kind: "note" as const, note })),
  ];

  useEffect(() => {
    if (open) {
      searchIdRef.current++;
      setQuery("");
      setSelectedIndex(0);
      setPhase("default");
      setLinkwardenResults([]);
      setLinkwardenLoading(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    // In Linkwarden phase, children[0] is the header, so offset by 1
    const offset = phase === "linkwarden" ? selectedIndex + 1 : selectedIndex;
    const el = listRef.current?.children[offset] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, phase]);

  if (!open) return null;

  async function searchLinkwarden(searchQuery: string) {
    const id = ++searchIdRef.current;
    setPhase("linkwarden");
    setLinkwardenLoading(true);
    setLinkwardenResults([]);
    setSelectedIndex(0);

    try {
      const { instances } = await getLinkwardenInstances();
      if (searchIdRef.current !== id) return;
      const allResults = await Promise.all(
        instances.map(async (instance) => {
          try {
            const response = await getLinkwardenLinks({
              instanceId: instance.id,
              searchQueryString: searchQuery,
            });
            return (response.response ?? []).map((link) => ({
              ...link,
              instanceName: instance.name,
            }));
          } catch {
            return [];
          }
        }),
      );
      if (searchIdRef.current !== id) return;
      setLinkwardenResults(allResults.flat());
    } catch {
      if (searchIdRef.current === id) setLinkwardenResults([]);
    } finally {
      if (searchIdRef.current === id) setLinkwardenLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (phase === "linkwarden") {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1 < linkwardenResults.length ? i + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 >= 0 ? i - 1 : Math.max(linkwardenResults.length - 1, 0)));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const link = linkwardenResults[selectedIndex];
        if (link) {
          void openExternal(link.url);
          onClose();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPhase("default");
        setSelectedIndex(0);
      } else if (e.key === "Backspace" && query === "") {
        e.preventDefault();
        setPhase("default");
        setSelectedIndex(0);
      }
      return;
    }

    // Phase 1 (default)
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1 < results.length ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 >= 0 ? i - 1 : Math.max(results.length - 1, 0)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = results[selectedIndex];
      if (item) {
        if (item.kind === "note") onSelect(item.note.id);
        else if (item.kind === "tab") {
          onTabSelect?.(item.id);
          onClose();
        } else if (item.kind === "linkwarden-action") {
          void searchLinkwarden(item.query);
        }
      }
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
        "fixed inset-0 z-50 bg-black/45",
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
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            readOnly={phase === "linkwarden" && linkwardenLoading}
          />
          <div
            className={cn(
              "max-h-[340px] overflow-y-auto p-1.5 [scrollbar-width:none]",
              "[&::-webkit-scrollbar]:hidden",
            )}
            ref={listRef}
          >
            {phase === "linkwarden" ? (
              <>
                <div className="px-3 pb-1.5 pt-1 text-[0.75rem] font-medium text-muted">
                  Linkwarden results
                </div>
                {linkwardenLoading ? (
                  <div className="flex items-center justify-center p-[18px]">
                    <Loader2 size={20} className="animate-spin text-muted" />
                  </div>
                ) : linkwardenResults.length === 0 ? (
                  <div className="p-[18px] text-center text-[0.88rem] text-faint">
                    No matching links
                  </div>
                ) : (
                  linkwardenResults.map((link, i) => (
                    <button
                      key={`${link.id}-${link.instanceName}`}
                      type="button"
                      className={cn(
                        "flex w-full cursor-pointer items-start justify-between gap-3 rounded-[10px] bg-transparent px-3 py-2.5 text-left hover:bg-white/[0.08]",
                        i === selectedIndex && "bg-white/[0.08]",
                      )}
                      onMouseEnter={() => setSelectedIndex(i)}
                      onClick={() => {
                        void openExternal(link.url);
                        onClose();
                      }}
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-[0.92rem] font-medium text-foreground">
                          {link.name || link.url}
                        </span>
                        <span className="truncate text-[0.78rem] leading-snug text-faint">
                          {link.url}
                        </span>
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-[0.78rem] text-faint">
                        {link.instanceName}
                      </span>
                    </button>
                  ))
                )}
              </>
            ) : (
              <>
                {results.length === 0 ? (
                  <div className="p-[18px] text-center text-[0.88rem] text-faint">No results</div>
                ) : (
                  results.map((item, i) => {
                    if (item.kind === "tab") {
                      const Icon = item.icon;
                      return (
                        <button
                          key={`tab-${item.id}`}
                          type="button"
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-3 rounded-[10px] bg-transparent px-3 py-2.5 text-left hover:bg-white/[0.08]",
                            i === selectedIndex && "bg-white/[0.08]",
                          )}
                          onMouseEnter={() => setSelectedIndex(i)}
                          onClick={() => {
                            onTabSelect?.(item.id);
                            onClose();
                          }}
                        >
                          <Icon size={16} strokeWidth={1.6} className="shrink-0 text-muted" />
                          <span className="truncate text-[0.92rem] font-medium text-foreground">
                            Jump to {item.label}
                          </span>
                        </button>
                      );
                    }

                    if (item.kind === "linkwarden-action") {
                      return (
                        <button
                          key="linkwarden-action"
                          type="button"
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-3 rounded-[10px] bg-transparent px-3 py-2.5 text-left hover:bg-white/[0.08]",
                            i === selectedIndex && "bg-white/[0.08]",
                          )}
                          onMouseEnter={() => setSelectedIndex(i)}
                          onClick={() => void searchLinkwarden(item.query)}
                        >
                          <Link size={16} strokeWidth={1.6} className="shrink-0 text-muted" />
                          <span className="truncate text-[0.92rem] font-medium text-foreground">
                            Search Linkwarden for &ldquo;{item.query}&rdquo;
                          </span>
                        </button>
                      );
                    }

                    const folder = folderFromPath(item.note.path);
                    const snippet = query.trim() ? getSnippet("", query.trim()) : null;
                    return (
                      <button
                        key={item.note.id}
                        type="button"
                        className={cn(
                          "flex w-full cursor-pointer items-start justify-between gap-3 rounded-[10px] bg-transparent px-3 py-2.5 text-left hover:bg-white/[0.08]",
                          i === selectedIndex && "bg-white/[0.08]",
                        )}
                        onMouseEnter={() => setSelectedIndex(i)}
                        onClick={() => onSelect(item.note.id)}
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-[0.92rem] font-medium text-foreground">
                            {item.note.title}
                          </span>
                          {snippet ? (
                            <span className="truncate text-[0.78rem] leading-snug text-faint">
                              {snippet}
                            </span>
                          ) : null}
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
