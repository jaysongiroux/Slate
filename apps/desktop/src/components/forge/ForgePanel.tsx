import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type {
  ForgeIssue,
  ForgeNotification,
  ForgePullRequest,
  ForgeRepo,
  Paged,
} from "@slate/shared";
import { useForgeStore } from "../../stores/forge-store";
import {
  addForgePinned,
  addForgeStarred,
  getForgeList,
  getForgeRepoIssues,
  getForgeRepoPRs,
  getForgeSavedSearchResults,
} from "../../lib/api";
import { ForgePrRow } from "./ForgePrRow";
import { ForgeIssueRow } from "./ForgeIssueRow";
import { ForgeNotificationRow } from "./ForgeNotificationRow";

type Item = ForgePullRequest | ForgeIssue | ForgeNotification | ForgeRepo;

function isPR(item: Item): item is ForgePullRequest {
  return "reviewState" in item;
}
function isIssue(item: Item): item is ForgeIssue {
  return "labels" in item && !("reviewState" in item);
}
function isNotification(item: Item): item is ForgeNotification {
  return "reason" in item;
}

export function ForgePanel() {
  const instanceId = useForgeStore((s) => s.selectedInstanceId);
  const view = useForgeStore((s) => s.view);
  const filter = useForgeStore((s) => s.activeFilter);
  const label = useForgeStore((s) => s.activeFilterLabel);
  const refreshSignal = useForgeStore((s) => s.refreshSignal);

  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset list state synchronously when the filter/instance identity changes.
  // React re-runs this block during the same render that sees the new filter,
  // so no frame ever shows stale items under a new filter label.
  const filterKey = `${instanceId ?? ""}|${filter?.kind ?? ""}|${filter?.repo ?? ""}|${
    filter?.savedSearchId ?? ""
  }`;
  const lastFilterKeyRef = useRef(filterKey);
  if (lastFilterKeyRef.current !== filterKey) {
    lastFilterKeyRef.current = filterKey;
    setItems([]);
    setCursor(null);
    setError(null);
    setLoading(Boolean(instanceId && filter));
  }

  const loadPage = useCallback(
    async (append: boolean, nextCursor?: string) => {
      if (!instanceId || !filter) return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        let page: Paged<Item>;
        if (filter.kind === "repo-prs" && filter.repo) {
          // Pass the full path (supports GitLab group/subgroup/project nesting).
          page = (await getForgeRepoPRs({
            instanceId,
            repo: filter.repo,
            cursor: nextCursor,
          })) as Paged<Item>;
        } else if (filter.kind === "repo-issues" && filter.repo) {
          page = (await getForgeRepoIssues({
            instanceId,
            repo: filter.repo,
            cursor: nextCursor,
          })) as Paged<Item>;
        } else if (filter.kind === "saved-search" && filter.savedSearchId) {
          page = (await getForgeSavedSearchResults({
            instanceId,
            searchId: filter.savedSearchId,
            cursor: nextCursor,
          })) as Paged<Item>;
        } else {
          page = (await getForgeList({
            instanceId,
            kind: filter.kind as
              | "my-prs"
              | "reviewing"
              | "notifications"
              | "assigned-issues"
              | "repos",
            cursor: nextCursor,
          })) as Paged<Item>;
        }
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [instanceId, filter],
  );

  useEffect(() => {
    void loadPage(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPage, refreshSignal]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && cursor && !loadingMore) {
          void loadPage(true, cursor);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [cursor, loadPage, loadingMore]);

  if (!instanceId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[0.85rem] text-faint">
        Select a GitHub or GitLab account.
      </div>
    );
  }
  if (view === "empty" || !filter) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[0.85rem] text-faint">
        Pick a filter or repo from the sidebar.
      </div>
    );
  }

  async function handlePin(kind: "pr" | "issue", repo: string, number: number) {
    if (!instanceId) return;
    try {
      await addForgePinned({ instanceId, kind, repo, number });
      toast.success("Pinned");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not pin");
    }
  }

  async function handleStarRepo(repo: string) {
    if (!instanceId) return;
    try {
      await addForgeStarred({ instanceId, repo });
      toast.success("Starred");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not star");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-white/[0.04] px-4 py-3 text-[0.9rem] font-medium text-foreground">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={label ?? "empty"}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 3 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="inline-block"
          >
            {label ?? ""}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
        <AnimatePresence mode="wait" initial={false}>
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="flex items-center justify-center py-8"
            >
              <Loader2 size={18} className="animate-spin text-faint" />
            </motion.div>
          ) : error ? (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="flex items-center justify-center py-8 text-[0.84rem] text-faint"
            >
              {error}
            </motion.div>
          ) : items.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="flex items-center justify-center py-8 text-[0.84rem] text-faint"
            >
              No results.
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.14 }}
              className="flex flex-col gap-0.5"
            >
              {items.map((item, index) => {
                const delay = Math.min(index, 12) * 0.012;
                const rowMotion = {
                  initial: { opacity: 0, y: 4 },
                  animate: { opacity: 1, y: 0 },
                  transition: { duration: 0.18, ease: "easeOut" as const, delay },
                };
                if (isNotification(item)) {
                  return (
                    <motion.div key={item.id} {...rowMotion}>
                      <ForgeNotificationRow notification={item} />
                    </motion.div>
                  );
                }
                if (isPR(item)) {
                  return (
                    <motion.div key={item.id} {...rowMotion}>
                      <ForgePrRow
                        pr={item}
                        onPin={() => void handlePin("pr", item.repo, item.number)}
                        onStarRepo={() => void handleStarRepo(item.repo)}
                      />
                    </motion.div>
                  );
                }
                if (isIssue(item)) {
                  return (
                    <motion.div key={item.id} {...rowMotion}>
                      <ForgeIssueRow
                        issue={item}
                        onPin={() => void handlePin("issue", item.repo, item.number)}
                        onStarRepo={() => void handleStarRepo(item.repo)}
                      />
                    </motion.div>
                  );
                }
                const r = item as ForgeRepo;
                return (
                  <motion.div
                    key={r.id}
                    {...rowMotion}
                    className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[0.84rem] text-muted hover:bg-white/[0.04]"
                    onClick={() => void handleStarRepo(r.fullName)}
                    title="Click to star"
                  >
                    <span className="min-w-0 flex-1 truncate">{r.fullName}</span>
                    {r.language && (
                      <span className="shrink-0 text-[0.72rem] text-faint">{r.language}</span>
                    )}
                  </motion.div>
                );
              })}
              <div ref={sentinelRef} />
              {cursor && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.18, delay: 0.04 }}
                  whileHover={{ backgroundColor: "rgba(255,255,255,0.08)" }}
                  className="my-2 cursor-pointer rounded-md bg-white/[0.04] py-1.5 text-[0.82rem] text-muted"
                  onClick={() => void loadPage(true, cursor)}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading..." : "Load more"}
                </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
