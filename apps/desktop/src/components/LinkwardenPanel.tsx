import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Loader2, Plus, Search } from "lucide-react";
import type { LinkwardenLink, LinkwardenInstance } from "@slate/shared";
import { ScrollArea } from "./ui/scroll-area";
import { getLinkwardenInstances, getLinkwardenLinks } from "../lib/api";
import { useLinkwardenStore } from "../stores/linkwarden-store";
import { useUiStore } from "../stores/ui-store";
import { LinkwardenLinkItem } from "./linkwarden/LinkwardenLinkItem";
import { LinkwardenDashboard } from "./linkwarden/LinkwardenDashboard";

export function LinkwardenPanel() {
  const selectedInstanceId = useLinkwardenStore((s) => s.selectedInstanceId);
  const view = useLinkwardenStore((s) => s.view);
  const setView = useLinkwardenStore((s) => s.setView);
  const selectedCollectionId = useLinkwardenStore((s) => s.selectedCollectionId);
  const selectedTagId = useLinkwardenStore((s) => s.selectedTagId);
  const searchQuery = useLinkwardenStore((s) => s.searchQuery);
  const setSearchQuery = useLinkwardenStore((s) => s.setSearchQuery);
  const setAddLinkOpen = useUiStore((s) => s.setAddLinkwardenLinkOpen);

  const [instances, setInstances] = useState<LinkwardenInstance[]>([]);
  const [links, setLinks] = useState<LinkwardenLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedInstance = instances.find((i) => i.id === selectedInstanceId) ?? null;
  const showDashboard =
    view === "dashboard" && !searchQuery && selectedCollectionId == null && selectedTagId == null;

  useEffect(() => {
    void getLinkwardenInstances()
      .then((res) => setInstances(res.instances))
      .catch(() => setInstances([]));
  }, [selectedInstanceId]);

  const fetchLinks = useCallback(async () => {
    if (!selectedInstanceId || showDashboard) {
      setLinks([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getLinkwardenLinks({
        instanceId: selectedInstanceId,
        collectionId: selectedCollectionId ?? undefined,
        tagId: selectedTagId ?? undefined,
        searchQueryString: searchQuery || undefined,
      });
      setLinks(result.response ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load links");
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, [selectedInstanceId, selectedCollectionId, selectedTagId, searchQuery, showDashboard]);

  useEffect(() => {
    if (showDashboard) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => {
        void fetchLinks();
      },
      searchQuery ? 300 : 0,
    );
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchLinks, searchQuery, showDashboard]);

  // Typing in search switches to links view
  function handleSearchChange(value: string) {
    setSearchQuery(value);
    if (value && view === "dashboard") {
      setView("links");
    }
  }

  if (!selectedInstanceId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[0.85rem] text-faint">
        Select an instance to browse links.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Search bar */}
      <div className="border-b border-white/[0.04] px-4 py-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-[6px]">
          <Search size={14} className="shrink-0 text-foreground/25" />
          <input
            type="text"
            placeholder="Search links..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent text-[0.82rem] text-foreground/75 outline-none placeholder:text-foreground/25"
          />
          {selectedInstance && (
            <span className="shrink-0 rounded border border-white/[0.05] bg-white/[0.03] px-1.5 py-0.5 text-[0.65rem] text-foreground/20">
              {selectedInstance.name}
            </span>
          )}
          <button
            type="button"
            className="flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.04] text-foreground/30 hover:bg-white/[0.08] hover:text-foreground/50"
            aria-label="Add link"
            onClick={() => setAddLinkOpen(true)}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Content */}
      {showDashboard ? (
        <ScrollArea className="note-scroll-area min-h-0 min-w-0 flex-1 [&_.ui-scroll-area__viewport]:overflow-x-hidden! [&_.ui-scroll-area__scrollbar--horizontal]:hidden [&_.ui-scroll-area__scrollbar--vertical]:hidden">
          <LinkwardenDashboard instanceId={selectedInstanceId} />
        </ScrollArea>
      ) : loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Loader2 size={18} className="animate-spin text-faint" />
        </div>
      ) : error ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="m-0 text-[0.82rem] text-foreground/40">{error}</p>
        </div>
      ) : links.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-[0.82rem] text-faint">
          {searchQuery ? `No links matching "${searchQuery}"` : "No links found."}
        </div>
      ) : (
        <ScrollArea className="note-scroll-area min-h-0 min-w-0 flex-1 [&_.ui-scroll-area__viewport]:overflow-x-hidden! [&_.ui-scroll-area__scrollbar--horizontal]:hidden [&_.ui-scroll-area__scrollbar--vertical]:hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${selectedInstanceId}-${selectedCollectionId ?? ""}-${selectedTagId ?? ""}-${searchQuery}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="flex w-full min-w-0 flex-col gap-px overflow-hidden px-4 py-2 pb-6"
            >
              {links.map((link) => (
                <LinkwardenLinkItem key={link.id} link={link} instanceId={selectedInstanceId} />
              ))}
            </motion.div>
          </AnimatePresence>
        </ScrollArea>
      )}
    </div>
  );
}
