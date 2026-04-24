import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bookmark,
  CheckSquare,
  ChevronRight,
  Eye,
  GitPullRequestArrow,
  Inbox,
  Loader2,
  Pin,
  Plus,
  Search,
  Star,
  UserCircle2,
  X,
} from "lucide-react";
import type {
  ForgeInstance,
  ForgePinnedItem,
  ForgeRepo,
  ForgeSavedSearch,
  Paged,
} from "@slate/shared";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import {
  addForgeStarred,
  getForgeInstances,
  getForgeList,
  getForgePinned,
  getForgeSavedSearches,
  getForgeStarred,
  openExternal,
  removeForgeInstance,
  removeForgeSavedSearch,
  removeForgeStarred,
  showContextMenu,
} from "../../lib/api";
import { useForgeStore, type ForgeQuickFilter } from "../../stores/forge-store";
import { useUiStore } from "../../stores/ui-store";
import { useForgeCounts } from "../../hooks/use-forge-counts";
import { cn } from "../../lib/utils";

type QuickFilterEntry = {
  id: ForgeQuickFilter;
  icon: typeof UserCircle2;
  label: string;
  countsKey: "myPRs" | "reviewing" | "notifications" | "assignedIssues";
};

const QUICK_FILTERS: QuickFilterEntry[] = [
  { id: "my-prs", icon: UserCircle2, label: "My open PRs/MRs", countsKey: "myPRs" },
  { id: "reviewing", icon: Eye, label: "Reviewing", countsKey: "reviewing" },
  { id: "notifications", icon: Inbox, label: "Notifications", countsKey: "notifications" },
  { id: "assigned-issues", icon: CheckSquare, label: "Issues assigned", countsKey: "assignedIssues" },
];

const ROW_CLASSES =
  "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] text-muted hover:bg-white/[0.06]";

export function ForgeSidebar({ backendAuthenticated }: { backendAuthenticated: boolean }) {
  const [instances, setInstances] = useState<ForgeInstance[]>([]);
  const [savedSearches, setSavedSearches] = useState<ForgeSavedSearch[]>([]);
  const [starred, setStarred] = useState<string[]>([]);
  const [pinned, setPinned] = useState<ForgePinnedItem[]>([]);
  const [repos, setRepos] = useState<ForgeRepo[]>([]);
  const [reposCursor, setReposCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [starredOpen, setStarredOpen] = useState(true);
  const [allOpen, setAllOpen] = useState(true);
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [repoQuery, setRepoQuery] = useState("");

  const selectedInstanceId = useForgeStore((s) => s.selectedInstanceId);
  const setSelectedInstanceId = useForgeStore((s) => s.setSelectedInstanceId);
  const counts = useForgeStore((s) =>
    selectedInstanceId ? s.countsByInstance[selectedInstanceId] : undefined,
  );
  const activeFilter = useForgeStore((s) => s.activeFilter);
  const setActiveFilter = useForgeStore((s) => s.setActiveFilter);
  const refreshSignal = useForgeStore((s) => s.refreshSignal);

  const setAddOpen = useUiStore((s) => s.setAddForgeInstanceOpen);
  const setEditingInstanceId = useUiStore((s) => s.setEditingForgeInstanceId);
  const setSaveSearchOpen = useUiStore((s) => s.setSaveForgeSearchOpen);

  useForgeCounts({
    instanceIds: instances.map((i) => i.id),
    active: backendAuthenticated,
  });

  const loadInstances = useCallback(async () => {
    if (!backendAuthenticated) {
      setInstances([]);
      return;
    }
    try {
      const result = await getForgeInstances();
      setInstances(result.instances);
      if (!selectedInstanceId && result.instances.length > 0) {
        setSelectedInstanceId(result.instances[0].id);
      }
    } catch {
      setInstances([]);
    }
  }, [backendAuthenticated, selectedInstanceId, setSelectedInstanceId]);

  useEffect(() => {
    void loadInstances();
  }, [loadInstances, refreshSignal]);

  const [instanceDataLoading, setInstanceDataLoading] = useState(false);

  const loadInstanceData = useCallback(async () => {
    if (!selectedInstanceId) {
      setSavedSearches([]);
      setStarred([]);
      setPinned([]);
      setRepos([]);
      setReposCursor(null);
      setInstanceDataLoading(false);
      return;
    }
    setInstanceDataLoading(true);
    try {
      const [s, st, p, r] = await Promise.all([
        getForgeSavedSearches({ instanceId: selectedInstanceId }),
        getForgeStarred({ instanceId: selectedInstanceId }),
        getForgePinned({ instanceId: selectedInstanceId }),
        getForgeList({ instanceId: selectedInstanceId, kind: "repos" }) as Promise<
          Paged<ForgeRepo>
        >,
      ]);
      setSavedSearches(s.searches);
      setStarred(st.repos);
      setPinned(p.items);
      setRepos(r.items);
      setReposCursor(r.nextCursor);
    } catch {
      // silent — empty fallback
    } finally {
      setInstanceDataLoading(false);
    }
  }, [selectedInstanceId]);

  // Clear stale sidebar lists the instant the instance changes (before the
  // new fetch returns) so we never show another account's repos/searches.
  const lastInstanceIdRef = useRef(selectedInstanceId);
  if (lastInstanceIdRef.current !== selectedInstanceId) {
    lastInstanceIdRef.current = selectedInstanceId;
    setSavedSearches([]);
    setStarred([]);
    setPinned([]);
    setRepos([]);
    setReposCursor(null);
    setExpandedRepos(new Set());
    setRepoQuery("");
    setInstanceDataLoading(Boolean(selectedInstanceId));
  }

  useEffect(() => {
    void loadInstanceData();
  }, [loadInstanceData, refreshSignal]);

  async function loadMoreRepos() {
    if (!selectedInstanceId || !reposCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = (await getForgeList({
        instanceId: selectedInstanceId,
        kind: "repos",
        cursor: reposCursor,
      })) as Paged<ForgeRepo>;
      setRepos((prev) => [...prev, ...page.items]);
      setReposCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleRepoExpand(repo: string) {
    setExpandedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });
  }

  async function onInstanceContextMenu(e: React.MouseEvent, id: string) {
    e.preventDefault();
    const choice = await showContextMenu([
      { id: "edit", label: "Edit Account" },
      { id: "remove", label: "Remove Account" },
    ]);
    if (choice === "edit") {
      setEditingInstanceId(id);
    } else if (choice === "remove") {
      await removeForgeInstance({ id });
      if (selectedInstanceId === id) setSelectedInstanceId(null);
      void loadInstances();
    }
  }

  async function onSavedSearchContextMenu(e: React.MouseEvent, searchId: string) {
    e.preventDefault();
    const choice = await showContextMenu([{ id: "remove", label: "Delete" }]);
    if (choice === "remove") {
      await removeForgeSavedSearch({ searchId });
      void loadInstanceData();
    }
  }

  async function onStarredContextMenu(e: React.MouseEvent, repo: string) {
    e.preventDefault();
    if (!selectedInstanceId) return;
    const choice = await showContextMenu([
      { id: "open", label: "Open in browser" },
      { id: "unstar", label: "Unstar" },
    ]);
    if (choice === "unstar") {
      await removeForgeStarred({ instanceId: selectedInstanceId, repo });
      void loadInstanceData();
    } else if (choice === "open") {
      const match = repos.find((r) => r.fullName === repo);
      if (match?.webUrl) await openExternal(match.webUrl);
    }
  }

  async function onRepoContextMenu(e: React.MouseEvent, repo: string) {
    e.preventDefault();
    if (!selectedInstanceId) return;
    const match = repos.find((r) => r.fullName === repo);
    const choice = await showContextMenu([
      { id: "star", label: "Star repo" },
      { id: "open", label: "Open in browser" },
    ]);
    if (choice === "star") {
      await addForgeStarred({ instanceId: selectedInstanceId, repo });
      void loadInstanceData();
    } else if (choice === "open" && match?.webUrl) {
      await openExternal(match.webUrl);
    }
  }

  if (!backendAuthenticated) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-[0.85rem] text-faint">
        Sign in to use GitHub / GitLab.
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="m-0 text-[0.85rem] text-faint">No GitHub or GitLab accounts yet.</p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          Add account
        </Button>
      </div>
    );
  }

  const selectedInstance = instances.find((i) => i.id === selectedInstanceId);

  const starredRepos = repos.filter((r) => starred.includes(r.fullName));
  const starredSet = new Set(starred);
  // ensure starred items appear even if not present in first page of /repos
  for (const s of starred) {
    if (!starredRepos.some((r) => r.fullName === s)) {
      starredRepos.push({
        id: s,
        fullName: s,
        provider: selectedInstance?.provider ?? "github",
        webUrl: "",
        isPrivate: false,
        updatedAt: "",
      });
    }
  }
  const nonStarredRepos = repos.filter((r) => !starredSet.has(r.fullName));

  const normalizedQuery = repoQuery.trim().toLowerCase();
  const hasQuery = normalizedQuery.length > 0;
  const matchesQuery = (r: ForgeRepo) =>
    !hasQuery || r.fullName.toLowerCase().includes(normalizedQuery);
  const filteredStarredRepos = starredRepos.filter(matchesQuery);
  const filteredNonStarredRepos = nonStarredRepos.filter(matchesQuery);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="mb-1.5 flex w-full items-center justify-between">
        <span
          className="text-[0.9rem] font-normal tracking-wide text-foreground"
          style={{ userSelect: "none" }}
        >
          Forge
        </span>
        <button
          type="button"
          className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
          aria-label="Add account"
          onClick={() => setAddOpen(true)}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Instance header */}
      <div
        className="relative mb-2 flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[0.82rem] text-muted hover:bg-white/[0.06]"
        onContextMenu={(e) => {
          if (selectedInstanceId) void onInstanceContextMenu(e, selectedInstanceId);
        }}
      >
        <GitPullRequestArrow size={14} className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate select-none">
          {selectedInstance?.name ?? "Select account"}
        </span>
        <AnimatePresence>
          {instanceDataLoading && (
            <motion.span
              key="hdr-spinner"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="inline-flex"
            >
              <Loader2 size={11} className="shrink-0 animate-spin text-faint" />
            </motion.span>
          )}
        </AnimatePresence>
        {instances.length > 1 && (
          <select
            value={selectedInstanceId ?? ""}
            onChange={(e) => setSelectedInstanceId(e.target.value || null)}
            className="cursor-pointer bg-transparent text-faint outline-none"
            title="Switch account"
          >
            {instances.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Quick filters */}
      <div className="mb-2 flex flex-col gap-0.5">
        {QUICK_FILTERS.map(({ id, icon: Icon, label, countsKey }, index) => {
          const isActive = activeFilter?.kind === id;
          const count = counts?.[countsKey] ?? 0;
          return (
            <motion.button
              key={id}
              type="button"
              initial={{ opacity: 0, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: index * 0.02, ease: "easeOut" }}
              className={cn(ROW_CLASSES, isActive && "bg-white/[0.08] text-foreground")}
              onClick={() => setActiveFilter({ kind: id }, label)}
            >
              <Icon size={13} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate select-none">{label}</span>
              <AnimatePresence mode="wait" initial={false}>
                {count > 0 && (
                  <motion.span
                    key={`count-${count}`}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ duration: 0.14 }}
                    className="shrink-0 text-[0.7rem] text-faint"
                  >
                    {count}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </div>

      {/* Repo search */}
      {(repos.length > 0 || starred.length > 0) && (
        <div className="mb-1.5 px-1.5">
          <div className="group relative">
            <Search
              size={12}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              type="search"
              value={repoQuery}
              onChange={(e) => setRepoQuery(e.target.value)}
              placeholder="Search repos..."
              className="w-full rounded-md border border-white/[0.06] bg-white/[0.03] py-1 pl-7 pr-6 text-[0.78rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.14]"
            />
            {repoQuery && (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 inline-flex size-[16px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-faint hover:bg-white/[0.08] hover:text-foreground"
                onClick={() => setRepoQuery("")}
              >
                <X size={10} />
              </button>
            )}
          </div>
        </div>
      )}

      <ScrollArea className="note-scroll-area flex min-h-0 flex-1 flex-col [&_.ui-scroll-area__viewport]:overflow-x-hidden! [&_.ui-scroll-area__scrollbar--horizontal]:hidden [&_.ui-scroll-area__scrollbar--vertical]:hidden">
        <AnimatePresence>
          {instanceDataLoading &&
          savedSearches.length === 0 &&
          starred.length === 0 &&
          repos.length === 0 ? (
            <motion.div
              key="scroll-spinner"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex items-center justify-center py-6"
            >
              <Loader2 size={14} className="animate-spin text-faint" />
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="flex min-w-0 flex-col gap-0.5 overflow-hidden pr-2 pb-3">
          {/* Saved searches */}
          <div className="mt-1 flex items-center justify-between px-1.5">
            <span className="flex items-center gap-1.5 text-[0.7rem] font-medium uppercase tracking-wider text-faint select-none">
              <Bookmark size={10} />
              Saved searches
            </span>
            <button
              type="button"
              className="inline-flex size-[18px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
              aria-label="Save new search"
              onClick={() => setSaveSearchOpen(true)}
            >
              <Plus size={11} />
            </button>
          </div>
          {savedSearches.length === 0 ? (
            <div className="px-1.5 py-0.5 text-[0.72rem] text-faint select-none">
              No saved searches.
            </div>
          ) : (
            savedSearches.map((s) => {
              const isActive =
                activeFilter?.kind === "saved-search" && activeFilter.savedSearchId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={cn(ROW_CLASSES, isActive && "bg-white/[0.08] text-foreground")}
                  onClick={() =>
                    setActiveFilter({ kind: "saved-search", savedSearchId: s.id }, s.name)
                  }
                  onContextMenu={(e) => void onSavedSearchContextMenu(e, s.id)}
                  title={s.query}
                >
                  <Bookmark size={13} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate select-none">{s.name}</span>
                </button>
              );
            })
          )}

          {/* Starred repos */}
          {filteredStarredRepos.length > 0 && (
            <>
              <button
                type="button"
                className="mt-2 flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1.5 pt-1 pb-0.5 text-left text-[0.7rem] font-medium uppercase tracking-wider text-faint hover:text-foreground select-none"
                onClick={() => setStarredOpen((o) => !o)}
              >
                <ChevronRight
                  size={10}
                  className={cn(
                    "shrink-0 transition-transform duration-150",
                    (starredOpen || hasQuery) && "rotate-90",
                  )}
                />
                <Star size={10} className="fill-current" />
                <span>Starred</span>
                <span className="ml-auto font-normal normal-case tracking-normal text-[0.65rem]">
                  {hasQuery
                    ? `${filteredStarredRepos.length}/${starredRepos.length}`
                    : starredRepos.length}
                </span>
              </button>
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out",
                  starredOpen || hasQuery ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="min-w-0 overflow-hidden">
                  {filteredStarredRepos.map((r) => (
                    <RepoRow
                      key={r.fullName}
                      repo={r}
                      expanded={expandedRepos.has(r.fullName)}
                      pinned={pinned.filter((p) => p.repo === r.fullName)}
                      onToggle={() => toggleRepoExpand(r.fullName)}
                      onClickPrs={() =>
                        setActiveFilter(
                          { kind: "repo-prs", repo: r.fullName },
                          `${r.fullName} / PRs`,
                        )
                      }
                      onClickIssues={() =>
                        setActiveFilter(
                          { kind: "repo-issues", repo: r.fullName },
                          `${r.fullName} / Issues`,
                        )
                      }
                      onContextMenu={(e) => void onStarredContextMenu(e, r.fullName)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* All repos */}
          {filteredNonStarredRepos.length > 0 && (
            <>
              <button
                type="button"
                className="mt-2 flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1.5 pt-1 pb-0.5 text-left text-[0.7rem] font-medium uppercase tracking-wider text-faint hover:text-foreground select-none"
                onClick={() => setAllOpen((o) => !o)}
              >
                <ChevronRight
                  size={10}
                  className={cn(
                    "shrink-0 transition-transform duration-150",
                    (allOpen || hasQuery) && "rotate-90",
                  )}
                />
                <span>All repos</span>
                <span className="ml-auto font-normal normal-case tracking-normal text-[0.65rem]">
                  {hasQuery
                    ? `${filteredNonStarredRepos.length}/${nonStarredRepos.length}`
                    : nonStarredRepos.length}
                </span>
              </button>
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out",
                  allOpen || hasQuery ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="min-w-0 overflow-hidden">
                  {filteredNonStarredRepos.map((r) => (
                    <RepoRow
                      key={r.fullName}
                      repo={r}
                      expanded={expandedRepos.has(r.fullName)}
                      pinned={pinned.filter((p) => p.repo === r.fullName)}
                      onToggle={() => toggleRepoExpand(r.fullName)}
                      onClickPrs={() =>
                        setActiveFilter(
                          { kind: "repo-prs", repo: r.fullName },
                          `${r.fullName} / PRs`,
                        )
                      }
                      onClickIssues={() =>
                        setActiveFilter(
                          { kind: "repo-issues", repo: r.fullName },
                          `${r.fullName} / Issues`,
                        )
                      }
                      onContextMenu={(e) => void onRepoContextMenu(e, r.fullName)}
                    />
                  ))}
                  {reposCursor && !hasQuery && (
                    <button
                      type="button"
                      className="w-full cursor-pointer border-0 bg-transparent px-1.5 py-1 text-left text-[0.78rem] text-faint hover:text-foreground"
                      onClick={() => void loadMoreRepos()}
                      disabled={loadingMore}
                    >
                      {loadingMore ? (
                        <span className="flex items-center gap-1.5">
                          <Loader2 size={10} className="animate-spin" />
                          Loading...
                        </span>
                      ) : (
                        "Load 25 more"
                      )}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {hasQuery &&
            filteredStarredRepos.length === 0 &&
            filteredNonStarredRepos.length === 0 && (
              <div className="px-1.5 py-2 text-[0.78rem] text-faint select-none">
                No repos match &ldquo;{repoQuery}&rdquo;.
              </div>
            )}
        </div>
      </ScrollArea>
    </div>
  );
}

function RepoRow({
  repo,
  expanded,
  pinned,
  onToggle,
  onClickPrs,
  onClickIssues,
  onContextMenu,
}: {
  repo: ForgeRepo;
  expanded: boolean;
  pinned: ForgePinnedItem[];
  onToggle: () => void;
  onClickPrs: () => void;
  onClickIssues: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <div>
      <div
        className="flex w-full min-w-0 items-center gap-0.5 overflow-hidden rounded-md text-[0.82rem] text-muted hover:bg-white/[0.06]"
        onContextMenu={onContextMenu}
      >
        <button
          type="button"
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-faint hover:text-foreground"
          onClick={onToggle}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <ChevronRight
            size={12}
            className={cn("transition-transform duration-150", expanded && "rotate-90")}
          />
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden border-0 bg-transparent py-1 pr-1.5 text-left text-inherit"
          onClick={onToggle}
          title={repo.fullName}
        >
          <span className="min-w-0 flex-1 truncate select-none">{repo.fullName}</span>
        </button>
      </div>
      {expanded && (
        <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-white/[0.04] pl-2">
          <button type="button" className={ROW_CLASSES} onClick={onClickPrs}>
            <span className="text-[0.78rem]">Open PRs</span>
          </button>
          <button type="button" className={ROW_CLASSES} onClick={onClickIssues}>
            <span className="text-[0.78rem]">Issues</span>
          </button>
          {pinned.map((p) => (
            <button
              key={p.id}
              type="button"
              className={ROW_CLASSES}
              onClick={() => void openExternal(p.webUrl)}
              title={p.title}
            >
              <Pin size={11} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate text-[0.78rem]">
                {p.kind === "pr" ? "PR" : "Issue"} #{p.number} — {p.title}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
