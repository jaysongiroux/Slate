import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bookmark,
  ChevronRight,
  Columns3,
  Eye,
  Loader2,
  LogIn,
  Plus,
  SquareKanban,
  Star,
  UserCircle2,
  WifiOff,
} from "lucide-react";
import type {
  JiraBoard,
  JiraInstance,
  JiraProject,
  JiraSprint,
  SavedJqlQuery,
} from "@slate/shared";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import {
  getJiraInstances,
  getJiraProjects,
  getJiraBoards,
  getJiraSprints,
  getJiraSavedQueries,
  removeJiraInstance,
  removeJiraSavedQuery,
  showContextMenu,
} from "../../lib/api";
import { useJiraStore } from "../../stores/jira-store";
import { useUiStore } from "../../stores/ui-store";
import { cn } from "../../lib/utils";
import { AddJiraInstanceDialog } from "./AddJiraInstanceDialog";
import { SaveQueryDialog } from "./SaveQueryDialog";
import { useNavigationStore } from "../../stores/navigation-store";

function SidebarProjectAvatar({ project }: { project: JiraProject }) {
  const [failed, setFailed] = useState(false);

  if (!project.avatarUrl || failed) {
    return (
      <div className="flex size-5 shrink-0 items-center justify-center rounded bg-white/[0.06] text-[0.6rem] font-medium text-faint">
        {project.key.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={project.avatarUrl}
      alt={project.name}
      className="size-5 shrink-0 rounded"
      onError={() => setFailed(true)}
    />
  );
}

function SidebarProjectRow({
  project,
  selected,
  expanded,
  boards,
  boardsLoading,
  selectedBoardId,
  onToggleExpand,
  onClick,
  onBoardClick,
}: {
  project: JiraProject;
  selected: boolean;
  expanded: boolean;
  boards: JiraBoard[];
  boardsLoading: boolean;
  selectedBoardId: number | null;
  onToggleExpand: () => void;
  onClick: () => void;
  onBoardClick: (board: JiraBoard) => void;
}) {
  return (
    <div>
      <div
        className={cn(
          "flex w-full min-w-0 items-center gap-0.5 overflow-hidden rounded-md text-[0.82rem] text-muted hover:bg-white/[0.06]",
          selected && "bg-white/[0.08] text-foreground",
        )}
      >
        {/* Chevron toggle */}
        <button
          type="button"
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-faint hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
        >
          <ChevronRight
            size={12}
            className={cn("transition-transform duration-150", expanded && "rotate-90")}
          />
        </button>

        {/* Clickable project name */}
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden border-0 bg-transparent py-1 pr-1.5 text-left text-inherit"
          onClick={onClick}
        >
          <SidebarProjectAvatar project={project} />
          <span className="min-w-0 flex-1 truncate select-none">{project.name}</span>
          <span className="shrink-0 text-[0.7rem] text-faint">{project.key}</span>
        </button>
      </div>

      {/* Expanded boards */}
      {expanded && (
        <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-white/[0.04] pl-2">
          {boardsLoading ? (
            <div className="flex items-center gap-2 px-1.5 py-1 text-[0.75rem] text-faint select-none">
              <Loader2 size={10} className="animate-spin" />
            </div>
          ) : boards.length === 0 ? (
            <div className="px-1.5 py-0.5 text-[0.72rem] text-faint select-none">No boards</div>
          ) : (
            boards.map((board) => (
              <button
                key={board.id}
                type="button"
                className={cn(
                  "flex w-full cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-left text-[0.78rem] text-muted hover:bg-white/[0.06]",
                  selectedBoardId === board.id && "bg-white/[0.08] text-foreground",
                )}
                onClick={() => onBoardClick(board)}
              >
                <Columns3 size={11} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate select-none">{board.name}</span>
                <span className="shrink-0 text-[0.6rem] text-faint">{board.type}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface JiraSidebarProps {
  backendReachable: boolean;
  backendAuthenticated: boolean;
  refreshSignal?: number;
  onOpenSettings: () => void;
}

export function JiraSidebar({
  backendReachable,
  backendAuthenticated,
  refreshSignal = 0,
  onOpenSettings,
}: JiraSidebarProps) {
  const [instances, setInstances] = useState<JiraInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [editingInstance, setEditingInstance] = useState<JiraInstance | null>(null);

  const selectedInstanceId = useJiraStore((s) => s.selectedInstanceId);
  const setSelectedInstanceId = useJiraStore((s) => s.setSelectedInstanceId);
  const selectedProjectKey = useJiraStore((s) => s.selectedProjectKey);
  const setSelectedProject = useJiraStore((s) => s.setSelectedProject);
  const selectedBoardId = useJiraStore((s) => s.selectedBoardId);
  const setSelectedBoardId = useJiraStore((s) => s.setSelectedBoardId);
  const selectedSprintId = useJiraStore((s) => s.selectedSprintId);
  const setSelectedSprintId = useJiraStore((s) => s.setSelectedSprintId);
  const activeFilterLabel = useJiraStore((s) => s.activeFilterLabel);
  const setIssueFilters = useJiraStore((s) => s.setIssueFilters);
  const setAddInstanceOpen = useUiStore((s) => s.setAddJiraInstanceOpen);
  const navPush = useNavigationStore((s) => s.push);

  function applyQuickFilter(label: string, jql: string) {
    setIssueFilters({ jql }, label);
    navPush({ type: "jira" });
  }

  function selectProject(projectKey: string, projectName: string) {
    setSelectedProject(projectKey, projectName);
    navPush({ type: "jira", projectKey });
  }

  const refresh = useCallback(async () => {
    if (!backendAuthenticated) {
      setInstances([]);
      setLoading(false);
      return;
    }
    try {
      const result = await getJiraInstances();
      setInstances(result.instances);
      if (!selectedInstanceId && result.instances.length > 0) {
        setSelectedInstanceId(result.instances[0].id);
      }
    } catch {
      setInstances([]);
    } finally {
      setLoading(false);
    }
  }, [backendAuthenticated, selectedInstanceId, setSelectedInstanceId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (refreshSignal > 0) void refresh();
  }, [refreshSignal, refresh]);

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [boardsByProject, setBoardsByProject] = useState<Record<string, JiraBoard[]>>({});
  const [boardsLoadingFor, setBoardsLoadingFor] = useState<Set<string>>(new Set());
  const [sprints, setSprints] = useState<JiraSprint[]>([]);
  const [sprintsLoading, setSprintsLoading] = useState(false);
  const [savedQueries, setSavedQueries] = useState<SavedJqlQuery[]>([]);
  const [saveQueryOpen, setSaveQueryOpen] = useState(false);
  const [editingQuery, setEditingQuery] = useState<SavedJqlQuery | null>(null);
  const [unstarredOpen, setUnstarredOpen] = useState(false);
  const [starredOpen, setStarredOpen] = useState(true);

  const refreshSavedQueries = useCallback(async () => {
    if (!backendAuthenticated) {
      setSavedQueries([]);
      return;
    }
    try {
      const result = await getJiraSavedQueries();
      setSavedQueries(result.queries);
    } catch {
      setSavedQueries([]);
    }
  }, [backendAuthenticated]);

  useEffect(() => {
    void refreshSavedQueries();
  }, [refreshSavedQueries]);

  async function handleQueryContextMenu(event: React.MouseEvent, query: SavedJqlQuery) {
    event.preventDefault();
    const selected = await showContextMenu([
      { id: "edit", label: "Edit Query" },
      { id: "remove", label: "Remove Query" },
    ]);
    if (selected === "edit") {
      setEditingQuery(query);
      setSaveQueryOpen(true);
    } else if (selected === "remove") {
      await removeJiraSavedQuery({ id: query.id });
      void refreshSavedQueries();
    }
  }

  // Track which projects we've already fetched boards for
  const fetchedBoardsFor = useRef<Set<string>>(new Set());

  // Load projects when instance is selected
  useEffect(() => {
    if (!selectedInstanceId) {
      setProjects([]);
      return;
    }
    setProjectsLoading(true);
    // Reset boards state when instance changes
    setExpandedProjects(new Set());
    setBoardsByProject({});
    fetchedBoardsFor.current = new Set();
    void getJiraProjects({ instanceId: selectedInstanceId })
      .then((result) => setProjects(result.projects))
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoading(false));
  }, [selectedInstanceId]);

  function toggleProjectExpand(projectKey: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectKey)) {
        next.delete(projectKey);
      } else {
        next.add(projectKey);
        // Fetch boards if we haven't yet
        if (!fetchedBoardsFor.current.has(projectKey) && selectedInstanceId) {
          fetchedBoardsFor.current.add(projectKey);
          setBoardsLoadingFor((s) => new Set(s).add(projectKey));
          void getJiraBoards({ instanceId: selectedInstanceId, projectKey })
            .then((result) => {
              setBoardsByProject((prev) => ({ ...prev, [projectKey]: result.boards }));
            })
            .catch(() => {
              setBoardsByProject((prev) => ({ ...prev, [projectKey]: [] }));
            })
            .finally(() => {
              setBoardsLoadingFor((s) => {
                const n = new Set(s);
                n.delete(projectKey);
                return n;
              });
            });
        }
      }
      return next;
    });
  }

  // Load sprints when a scrum board is selected
  useEffect(() => {
    if (!selectedInstanceId || !selectedBoardId) {
      setSprints([]);
      return;
    }
    // Find the board across all projects
    const allBoards = Object.values(boardsByProject).flat();
    const board = allBoards.find((b) => b.id === selectedBoardId);
    if (!board || board.type === "kanban") {
      setSprints([]);
      return;
    }
    setSprintsLoading(true);
    void getJiraSprints({ instanceId: selectedInstanceId, boardId: selectedBoardId })
      .then((result) => setSprints(result.sprints))
      .catch(() => setSprints([]))
      .finally(() => setSprintsLoading(false));
  }, [selectedInstanceId, selectedBoardId, boardsByProject]);

  async function handleInstanceContextMenu(event: React.MouseEvent, instanceId: string) {
    event.preventDefault();
    const selected = await showContextMenu([
      { id: "edit", label: "Edit Instance" },
      { id: "remove", label: "Remove Instance" },
    ]);
    if (selected === "edit") {
      const inst = instances.find((i) => i.id === instanceId);
      if (inst) setEditingInstance(inst);
    } else if (selected === "remove") {
      setConfirmingDelete(instanceId);
    }
  }

  async function handleConfirmDelete() {
    if (!confirmingDelete) return;
    await removeJiraInstance({ id: confirmingDelete });
    if (selectedInstanceId === confirmingDelete) {
      setSelectedInstanceId(null);
    }
    setConfirmingDelete(null);
    await refresh();
  }

  const selectedInstance = instances.find((i) => i.id === selectedInstanceId);

  if (!backendReachable || !backendAuthenticated) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-white/[0.06]">
          {!backendReachable ? (
            <WifiOff size={18} className="text-faint" />
          ) : (
            <LogIn size={18} className="text-faint" />
          )}
        </div>
        <p className="m-0 text-[0.85rem] leading-snug text-muted">
          {!backendReachable
            ? "Jira requires a backend connection."
            : "Sign in to your backend to use Jira."}
        </p>
        <Button size="sm" variant="secondary" onClick={onOpenSettings}>
          {!backendReachable ? "Connect backend" : "Sign in"}
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 size={18} className="animate-spin text-faint" />
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-white/[0.06]">
          <SquareKanban size={18} className="text-faint" />
        </div>
        <p className="m-0 text-[0.85rem] leading-snug text-muted">
          Add a Jira instance to get started.
        </p>
        <Button size="sm" variant="secondary" onClick={() => setAddInstanceOpen(true)}>
          Add instance
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="mb-1.5 flex w-full items-center justify-between">
        <span
          className="text-[0.9rem] font-normal tracking-wide text-foreground"
          style={{ userSelect: "none" }}
        >
          Jira
        </span>
        <button
          type="button"
          className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
          aria-label="Add instance"
          onClick={() => setAddInstanceOpen(true)}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Instance name (right-click for context menu) */}
      <div
        className="mb-2 flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[0.82rem] text-muted hover:bg-white/[0.06]"
        onClick={() => {
          useJiraStore.getState().resetNavigation();
          navPush({ type: "jira" });
        }}
        onContextMenu={(e) => {
          if (selectedInstanceId) void handleInstanceContextMenu(e, selectedInstanceId);
        }}
      >
        <SquareKanban size={14} className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate select-none">
          {selectedInstance?.name ?? "Select instance"}
        </span>
        {instances.length > 1 && (
          <select
            value={selectedInstanceId ?? ""}
            onChange={(e) => setSelectedInstanceId(e.target.value || null)}
            className="absolute inset-0 cursor-pointer opacity-0"
            style={{ position: "relative", width: "auto", maxWidth: 20 }}
            title="Switch instance"
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
        <button
          type="button"
          className={cn(
            "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] text-muted hover:bg-white/[0.06]",
            activeFilterLabel === "Assigned to Me" && "bg-white/[0.08] text-foreground",
          )}
          onClick={() =>
            applyQuickFilter("Assigned to Me", "assignee = currentUser() ORDER BY updated DESC")
          }
        >
          <UserCircle2 size={13} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate select-none">Assigned to Me</span>
        </button>
        <button
          type="button"
          className={cn(
            "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] text-muted hover:bg-white/[0.06]",
            activeFilterLabel === "Watching" && "bg-white/[0.08] text-foreground",
          )}
          onClick={() =>
            applyQuickFilter("Watching", "watcher = currentUser() ORDER BY updated DESC")
          }
        >
          <Eye size={13} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate select-none">Watching</span>
        </button>

        {/* Saved queries — shown inline under quick filters */}
        {selectedInstanceId && (
          <>
            <div className="mt-1 flex items-center justify-between px-1.5">
              <span className="flex items-center gap-1.5 text-[0.7rem] font-medium uppercase tracking-wider text-faint select-none">
                <Bookmark size={10} />
                Saved Queries
              </span>
              <button
                type="button"
                className="inline-flex size-[18px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
                aria-label="Save new query"
                onClick={() => {
                  setEditingQuery(null);
                  setSaveQueryOpen(true);
                }}
              >
                <Plus size={11} />
              </button>
            </div>
            {savedQueries.filter((q) => q.instanceId === selectedInstanceId).length === 0 ? (
              <div className="px-1.5 py-0.5 text-[0.72rem] text-faint select-none">
                No saved queries.
              </div>
            ) : (
              savedQueries
                .filter((q) => q.instanceId === selectedInstanceId)
                .map((query) => (
                  <button
                    key={query.id}
                    type="button"
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] text-muted hover:bg-white/[0.06]",
                      activeFilterLabel === query.name && "bg-white/[0.08] text-foreground",
                    )}
                    onClick={() => applyQuickFilter(query.name, query.jql)}
                    onContextMenu={(e) => void handleQueryContextMenu(e, query)}
                    title={query.jql}
                  >
                    <Bookmark size={13} className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate select-none">{query.name}</span>
                  </button>
                ))
            )}
          </>
        )}
      </div>

      {/* Project list */}
      <ScrollArea className="note-scroll-area flex min-h-0 flex-1 flex-col [&_.ui-scroll-area__viewport]:overflow-x-hidden! [&_.ui-scroll-area__scrollbar--horizontal]:hidden [&_.ui-scroll-area__scrollbar--vertical]:hidden">
        <div className="flex min-w-0 flex-col gap-0.5 overflow-hidden pr-2 pb-3">
          {projectsLoading ? (
            <div className="flex items-center gap-2 px-1.5 py-1 text-[0.8rem] text-faint select-none">
              <Loader2 size={12} className="animate-spin" />
              Loading projects...
            </div>
          ) : projects.length === 0 ? (
            <div className="px-1.5 py-1 text-[0.8rem] text-faint select-none">
              No projects found.
            </div>
          ) : (
            (() => {
              const favourites = projects.filter((p) => p.favourite);
              const others = projects.filter((p) => !p.favourite);

              function renderProject(project: JiraProject) {
                return (
                  <SidebarProjectRow
                    key={project.id}
                    project={project}
                    selected={selectedProjectKey === project.key}
                    expanded={expandedProjects.has(project.key)}
                    boards={boardsByProject[project.key] ?? []}
                    boardsLoading={boardsLoadingFor.has(project.key)}
                    selectedBoardId={selectedBoardId}
                    onToggleExpand={() => toggleProjectExpand(project.key)}
                    onClick={() => selectProject(project.key, project.name)}
                    onBoardClick={(board) => {
                      // Select the project first if not already selected
                      if (selectedProjectKey !== project.key) {
                        setSelectedProject(project.key, project.name);
                      }
                      setSelectedBoardId(board.id);
                      navPush({ type: "jira", projectKey: project.key, boardId: board.id });
                    }}
                  />
                );
              }

              return (
                <>
                  {favourites.length > 0 && (
                    <>
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1.5 pt-1 pb-0.5 text-left text-[0.7rem] font-medium uppercase tracking-wider text-faint hover:text-foreground select-none"
                        onClick={() => setStarredOpen((o) => !o)}
                      >
                        <ChevronRight
                          size={10}
                          className={cn(
                            "shrink-0 transition-transform duration-150",
                            starredOpen && "rotate-90",
                          )}
                        />
                        <Star size={10} className="fill-current" />
                        <span>Starred</span>
                        <span className="ml-auto font-normal normal-case tracking-normal text-[0.65rem]">
                          {favourites.length}
                        </span>
                      </button>
                      <div
                        className={cn(
                          "grid transition-[grid-template-rows] duration-200 ease-out",
                          starredOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                        )}
                      >
                        <div className="min-w-0 overflow-hidden">
                          <div className="flex flex-col gap-0.5">
                            {favourites.map(renderProject)}
                          </div>
                        </div>
                      </div>
                      {others.length > 0 && <div className="my-1 border-t border-white/[0.04]" />}
                    </>
                  )}
                  {others.length > 0 && (
                    <>
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1.5 pt-1 pb-0.5 text-left text-[0.7rem] font-medium uppercase tracking-wider text-faint hover:text-foreground select-none"
                        onClick={() => setUnstarredOpen((o) => !o)}
                      >
                        <ChevronRight
                          size={10}
                          className={cn(
                            "shrink-0 transition-transform duration-150",
                            unstarredOpen && "rotate-90",
                          )}
                        />
                        <span>All Projects</span>
                        <span className="ml-auto font-normal normal-case tracking-normal text-[0.65rem]">
                          {others.length}
                        </span>
                      </button>
                      <div
                        className={cn(
                          "grid transition-[grid-template-rows] duration-200 ease-out",
                          unstarredOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                        )}
                      >
                        <div className="min-w-0 overflow-hidden">
                          <div className="flex flex-col gap-0.5">{others.map(renderProject)}</div>
                        </div>
                      </div>
                    </>
                  )}
                </>
              );
            })()
          )}
        </div>
      </ScrollArea>

      {/* Sprint selector — shown when a scrum board is selected */}
      {selectedBoardId && sprints.length > 0 && (
        <div className="mt-1 border-t border-white/[0.04] pt-2">
          <div className="mb-1 px-1.5 text-[0.7rem] font-medium uppercase tracking-wider text-faint select-none">
            Sprint
          </div>
          {sprintsLoading ? (
            <div className="flex items-center gap-2 px-1.5 py-1 text-[0.8rem] text-faint select-none">
              <Loader2 size={12} className="animate-spin" />
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] text-muted hover:bg-white/[0.06]",
                  selectedSprintId === null && "bg-white/[0.08] text-foreground",
                )}
                onClick={() => setSelectedSprintId(null)}
              >
                <span className="min-w-0 flex-1 truncate select-none">All issues</span>
              </button>
              {sprints.map((sprint) => (
                <button
                  key={sprint.id}
                  type="button"
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] text-muted hover:bg-white/[0.06]",
                    selectedSprintId === sprint.id && "bg-white/[0.08] text-foreground",
                  )}
                  onClick={() => setSelectedSprintId(sprint.id)}
                >
                  <span className="min-w-0 flex-1 truncate select-none">{sprint.name}</span>
                  <span className="shrink-0 text-[0.65rem] text-faint">{sprint.state}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Save query dialog */}
      <SaveQueryDialog
        open={saveQueryOpen}
        onOpenChange={(open) => {
          setSaveQueryOpen(open);
          if (!open) setEditingQuery(null);
        }}
        instanceId={selectedInstanceId}
        editQuery={editingQuery}
        initialJql={!editingQuery ? (activeFilterLabel ? undefined : "") : undefined}
        onSaved={() => {
          void refreshSavedQueries();
        }}
      />

      {/* Edit instance dialog */}
      <AddJiraInstanceDialog
        open={editingInstance !== null}
        onOpenChange={(open) => {
          if (!open) setEditingInstance(null);
        }}
        onAdded={() => {
          setEditingInstance(null);
          void refresh();
        }}
        editInstance={editingInstance}
      />

      {/* Delete confirmation dialog */}
      {confirmingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setConfirmingDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#1c1c1e] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="m-0 mb-2 text-[0.95rem] font-semibold text-foreground">
              Remove Jira Instance
            </h3>
            <p className="m-0 mb-4 text-[0.82rem] leading-relaxed text-muted">
              Are you sure you want to remove{" "}
              <strong>{instances.find((i) => i.id === confirmingDelete)?.name}</strong>? This will
              remove the saved connection and credentials.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleConfirmDelete()}
                className="bg-red-500/20 text-red-400 hover:bg-red-500/30"
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
