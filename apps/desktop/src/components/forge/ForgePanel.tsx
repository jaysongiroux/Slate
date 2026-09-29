import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import type {
  ForgeIssue,
  ForgeNotification,
  ForgePullRequest,
  ForgePrSearchState,
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
  searchForgePRs,
} from "../../lib/api";
import { ForgePrRow } from "./ForgePrRow";
import { ForgeIssueRow } from "./ForgeIssueRow";
import { ForgeNotificationRow } from "./ForgeNotificationRow";

type Item = ForgePullRequest | ForgeIssue | ForgeNotification | ForgeRepo;
const SEARCH_DEBOUNCE_MS = 400;

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
  const [searchDraft, setSearchDraft] = useState("");
  const [repoSearchDraft, setRepoSearchDraft] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const lastInstanceRef = useRef(instanceId);
  if (lastInstanceRef.current !== instanceId) {
    lastInstanceRef.current = instanceId;
    setSearchDraft("");
    setRepoSearchDraft("");
  }
  const activeRepo = filter?.kind === "repo-prs" ? filter.repo : null;
  const lastRepoRef = useRef(activeRepo);
  if (lastRepoRef.current !== activeRepo) {
    lastRepoRef.current = activeRepo;
    setRepoSearchDraft("");
  }

  // Reset list state synchronously when the filter/instance identity changes.
  // React re-runs this block during the same render that sees the new filter,
  // so no frame ever shows stale items under a new filter label.
  const filterKey = `${instanceId ?? ""}|${filter?.kind ?? ""}|${filter?.repo ?? ""}|${
    filter?.savedSearchId ?? ""
  }|${filter?.query ?? ""}|${filter?.searchState ?? ""}`;
  const requestIdentityRef = useRef(filterKey);
  const requestVersionRef = useRef(0);
  requestIdentityRef.current = filterKey;
  const lastFilterKeyRef = useRef(filterKey);
  if (lastFilterKeyRef.current !== filterKey) {
    lastFilterKeyRef.current = filterKey;
    requestVersionRef.current += 1;
    setItems([]);
    setCursor(null);
    setError(null);
    setLoadingMore(false);
    setLoading(Boolean(instanceId && filter && (filter.kind !== "search-prs" || filter.query)));
  }

  const loadPage = useCallback(
    async (append: boolean, nextCursor?: string) => {
      if (!instanceId || !filter || (filter.kind === "search-prs" && !filter.query)) return;
      const identity = filterKey;
      if (!append) requestVersionRef.current += 1;
      const version = requestVersionRef.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        let page: Paged<Item>;
        if (filter.kind === "search-prs") {
          page = await searchForgePRs({
            instanceId,
            query: filter.query!,
            state: filter.searchState ?? "all",
            cursor: nextCursor,
          });
        } else if (filter.kind === "repo-prs" && filter.repo) {
          // Pass the full path (supports GitLab group/subgroup/project nesting).
          page = (await getForgeRepoPRs({
            instanceId,
            repo: filter.repo,
            cursor: nextCursor,
            query: filter.query,
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
        if (requestIdentityRef.current === identity && requestVersionRef.current === version) {
          setItems((prev) => (append ? [...prev, ...page.items] : page.items));
          setCursor(page.nextCursor);
        }
      } catch (err) {
        if (requestIdentityRef.current === identity && requestVersionRef.current === version) {
          const message = err instanceof Error ? err.message : "Failed to load";
          setError(
            filter.kind === "search-prs" && /404 Route GET.*search-prs/.test(message)
              ? "Search requires an updated Slate server."
              : filter.kind === "repo-prs" &&
                  filter.query &&
                  /404 Route GET.*repo-prs\/search/.test(message)
                ? "Project search requires an updated Slate server."
                : message,
          );
        }
      } finally {
        if (requestIdentityRef.current === identity && requestVersionRef.current === version) {
          if (append) setLoadingMore(false);
          else setLoading(false);
        }
      }
    },
    [instanceId, filter, filterKey],
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

  useEffect(() => {
    if (view !== "search-prs" || !instanceId) return;
    const query = searchDraft.trim();
    if (query === (filter?.query ?? "")) return;
    const timeout = window.setTimeout(() => {
      const state = useForgeStore.getState();
      if (state.selectedInstanceId !== instanceId || state.activeFilter?.kind !== "search-prs")
        return;
      state.setActiveFilter(
        {
          kind: "search-prs",
          query: query || undefined,
          searchState: state.activeFilter.searchState,
        },
        "Search PRs/MRs",
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [filter?.query, instanceId, searchDraft, view]);

  useEffect(() => {
    if (view !== "repo-prs" || !instanceId || !activeRepo) return;
    const query = repoSearchDraft.trim();
    if (query === (filter?.query ?? "")) return;
    const timeout = window.setTimeout(() => {
      const state = useForgeStore.getState();
      if (
        state.selectedInstanceId !== instanceId ||
        state.activeFilter?.kind !== "repo-prs" ||
        state.activeFilter.repo !== activeRepo
      )
        return;
      state.setActiveFilter(
        { kind: "repo-prs", repo: activeRepo, query: query || undefined },
        state.activeFilterLabel ?? `${activeRepo} / PRs`,
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [activeRepo, filter?.query, instanceId, repoSearchDraft, view]);

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

  function changeSearchState(state: ForgePrSearchState) {
    useForgeStore
      .getState()
      .setActiveFilter(
        { kind: "search-prs", query: searchDraft.trim() || undefined, searchState: state },
        "Search PRs/MRs",
      );
  }

  function clearRepoSearch() {
    if (filter?.kind !== "repo-prs" || !filter.repo) return;
    setRepoSearchDraft("");
    useForgeStore
      .getState()
      .setActiveFilter({ kind: "repo-prs", repo: filter.repo }, label ?? `${filter.repo} / PRs`);
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
      {view === "repo-prs" && (
        <div className="flex items-center gap-2 border-b border-white/[0.04] px-4 py-3">
          <Search size={15} className="shrink-0 text-faint" />
          <input
            type="search"
            value={repoSearchDraft}
            onChange={(event) => setRepoSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const query = repoSearchDraft.trim();
              if (query === (filter.query ?? "")) return;
              useForgeStore
                .getState()
                .setActiveFilter(
                  { kind: "repo-prs", repo: filter.repo, query: query || undefined },
                  label ?? `${filter.repo} / PRs`,
                );
            }}
            maxLength={200}
            aria-label="Search open pull and merge requests in this project"
            placeholder="Search open PRs/MRs in this project..."
            className="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.84rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.18]"
          />
          {filter.query && (
            <button
              type="button"
              onClick={clearRepoSearch}
              className="rounded-md px-2 py-1.5 text-[0.8rem] text-faint hover:bg-white/[0.06] hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      )}
      {view === "search-prs" && (
        <div className="border-b border-white/[0.04] px-4 py-3">
          <div className="flex items-center gap-2">
            <Search size={15} className="shrink-0 text-faint" />
            <input
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const query = searchDraft.trim();
                if (query === (filter.query ?? "")) return;
                useForgeStore
                  .getState()
                  .setActiveFilter(
                    {
                      kind: "search-prs",
                      query: query || undefined,
                      searchState: filter.searchState,
                    },
                    "Search PRs/MRs",
                  );
              }}
              maxLength={200}
              aria-label="Search pull and merge requests"
              placeholder="Search titles and descriptions..."
              className="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.84rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.18]"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Pull request state">
            {(["all", "open", "merged", "closed"] as const).map((state) => (
              <button
                key={state}
                type="button"
                aria-pressed={(filter?.searchState ?? "all") === state}
                onClick={() => changeSearchState(state)}
                className={`rounded-md px-2 py-1 text-[0.72rem] capitalize transition-colors ${
                  (filter?.searchState ?? "all") === state
                    ? "bg-white/[0.12] text-foreground"
                    : "text-faint hover:bg-white/[0.06] hover:text-foreground"
                }`}
              >
                {state}
              </button>
            ))}
          </div>
        </div>
      )}
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
          ) : view === "search-prs" && !filter.query ? (
            <div className="flex items-center justify-center py-8 text-[0.84rem] text-faint">
              Enter text to search PRs and MRs across this account’s repositories.
            </div>
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
