import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Search, X } from "lucide-react";
import type { JiraIssue, JiraUser } from "@slate/shared";
import { getJiraIssues, searchJiraUsers } from "../../lib/api";
import { formatJiraError } from "./jira-errors";
import { useNavigationStore } from "../../stores/navigation-store";
import { useJiraStore } from "../../stores/jira-store";
import { ScrollArea } from "../ui/scroll-area";
import { Button } from "../ui/button";
import { IssueRow } from "./IssueRow";
import { CreateIssueDialog } from "./CreateIssueDialog";

const PAGE_SIZE = 30;

function isJql(query: string): boolean {
  const jqlPatterns = /\b(=|!=|~|!~|is\s|in\s|not\s|and\s|or\s|order\s+by)\b/i;
  return jqlPatterns.test(query);
}

/** Matches issue keys like "PROJ-123", "GM3K-6" */
function isIssueKey(query: string): boolean {
  return /^[A-Z][A-Z0-9]+-\d+$/i.test(query);
}

function buildJql(
  query: string,
  projectKey: string | null,
  storeFilters: { jql?: string; assignee?: string; watcher?: string },
  hideDone: boolean,
  assigneeFilter: string,
): string | undefined {
  if (storeFilters.jql) return storeFilters.jql;

  const trimmed = query.trim();

  if (trimmed && isJql(trimmed)) return trimmed;

  const clauses: string[] = [];
  if (projectKey) clauses.push(`project = "${projectKey}"`);
  if (trimmed) {
    if (isIssueKey(trimmed)) {
      clauses.push(`key = "${trimmed.toUpperCase()}"`);
    } else {
      clauses.push(`text ~ "${trimmed.replace(/"/g, '\\"')}"`);
    }
  }
  if (hideDone) clauses.push(`statusCategory != "Done"`);
  if (assigneeFilter) clauses.push(`assignee = "${assigneeFilter}"`);
  if (storeFilters.assignee) clauses.push(`assignee = "${storeFilters.assignee}"`);
  if (storeFilters.watcher) clauses.push(`watcher = "${storeFilters.watcher}"`);

  if (clauses.length === 0) return "ORDER BY updated DESC";
  return clauses.join(" AND ") + " ORDER BY updated DESC";
}

// ---------------------------------------------------------------------------
// Assignee filter picker
// ---------------------------------------------------------------------------

function AssigneeFilterPicker({
  instanceId,
  value,
  displayName,
  onChange,
}: {
  instanceId: string;
  value: string;
  displayName: string;
  onChange: (accountId: string, displayName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<JiraUser[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number>(0);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      setLoading(true);
      void searchJiraUsers({ instanceId, query })
        .then((r) => setUsers(r.users))
        .catch(() => setUsers([]))
        .finally(() => setLoading(false));
    }, 200);
  }, [open, query, instanceId]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[0.75rem] text-muted transition-colors hover:border-white/[0.12] hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        {displayName || "Assignee"}
        {value && (
          <span
            className="inline-flex cursor-pointer items-center text-faint hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onChange("", "");
            }}
          >
            <X size={10} />
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-full left-0 z-20 mt-1 w-[220px] rounded-lg border border-white/[0.08] bg-[#1c1c1e] shadow-xl">
          <div className="border-b border-white/[0.06] p-2">
            <input
              type="text"
              placeholder="Search users..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[0.82rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
              autoFocus
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto py-1 [scrollbar-width:none]">
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-[0.82rem] text-faint hover:bg-white/[0.06]"
              onClick={() => {
                onChange("", "");
                setOpen(false);
              }}
            >
              Anyone
            </button>
            {loading ? (
              <div className="flex justify-center py-2">
                <Loader2 size={14} className="animate-spin text-faint" />
              </div>
            ) : (
              users.map((u) => (
                <button
                  key={u.accountId}
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-[0.82rem] text-muted hover:bg-white/[0.06] hover:text-foreground"
                  onClick={() => {
                    onChange(u.accountId, u.displayName);
                    setOpen(false);
                  }}
                >
                  {u.avatarUrl && <img src={u.avatarUrl} alt="" className="size-5 rounded-full" />}
                  <span className="truncate">{u.displayName}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IssueList
// ---------------------------------------------------------------------------

export function IssueList() {
  const selectedInstanceId = useJiraStore((s) => s.selectedInstanceId);
  const selectedProjectKey = useJiraStore((s) => s.selectedProjectKey);
  const selectedProjectName = useJiraStore((s) => s.selectedProjectName);
  const issueFilters = useJiraStore((s) => s.issueFilters);
  const issuesRefreshSignal = useJiraStore((s) => s.issuesRefreshSignal);
  const setSelectedIssueKey = useJiraStore((s) => s.setSelectedIssueKey);
  const navPush = useNavigationStore((s) => s.push);
  const refreshIssues = useJiraStore((s) => s.refreshIssues);

  const [searchQuery, setSearchQuery] = useState("");
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Local filters
  const [hideDone, setHideDone] = useState(true);
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [assigneeDisplayName, setAssigneeDisplayName] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fetchIdRef = useRef(0);

  function selectIssue(issueKey: string) {
    setSelectedIssueKey(issueKey);
    navPush({ type: "jira", projectKey: selectedProjectKey ?? undefined, issueKey });
  }

  // ---- Initial fetch (reset list) ----
  useEffect(() => {
    const id = ++fetchIdRef.current;
    setCursor(null);
    setIssues([]);
    setError(null);

    clearTimeout(debounceRef.current);
    const delay = searchQuery.trim() ? 300 : 0;

    debounceRef.current = setTimeout(async () => {
      if (!selectedInstanceId) return;
      setInitialLoading(true);
      try {
        const jql = buildJql(
          searchQuery,
          selectedProjectKey,
          issueFilters,
          hideDone,
          assigneeFilter,
        );
        const result = await getJiraIssues({
          instanceId: selectedInstanceId,
          jql,
          maxResults: PAGE_SIZE,
        });
        if (fetchIdRef.current !== id) return;
        setIssues(result.issues);
        setCursor(result.nextPageToken);
      } catch (err) {
        if (fetchIdRef.current !== id) return;
        setError(formatJiraError(err, "Failed to load issues."));
      } finally {
        if (fetchIdRef.current === id) setInitialLoading(false);
      }
    }, delay);

    return () => clearTimeout(debounceRef.current);
  }, [
    selectedInstanceId,
    selectedProjectKey,
    issueFilters,
    searchQuery,
    issuesRefreshSignal,
    hideDone,
    assigneeFilter,
  ]);

  // ---- Load more (append to list) ----
  async function handleLoadMore() {
    if (!selectedInstanceId || !cursor || moreLoading) return;
    const id = fetchIdRef.current;
    setMoreLoading(true);
    try {
      const jql = buildJql(searchQuery, selectedProjectKey, issueFilters, hideDone, assigneeFilter);
      const result = await getJiraIssues({
        instanceId: selectedInstanceId,
        jql,
        nextPageToken: cursor,
        maxResults: PAGE_SIZE,
      });
      if (fetchIdRef.current !== id) return;
      setIssues((prev) => [...prev, ...result.issues]);
      setCursor(result.nextPageToken);
    } catch (err) {
      if (fetchIdRef.current !== id) return;
      setError(formatJiraError(err, "Failed to load more issues."));
    } finally {
      if (fetchIdRef.current === id) setMoreLoading(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      {selectedProjectKey && (
        <div className="flex items-center gap-2 border-b border-white/[0.04] px-5 py-3">
          <span className="flex-1 text-[0.92rem] font-medium text-foreground">
            {selectedProjectName ?? selectedProjectKey}
          </span>
          <button
            type="button"
            className="inline-flex size-[24px] cursor-pointer items-center justify-center rounded-md bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
            aria-label="Create issue"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={15} />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="border-b border-white/[0.04] px-4 py-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-[6px]">
          <Search size={14} className="shrink-0 text-faint" />
          <input
            type="text"
            placeholder="Search issues or enter JQL..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent text-[0.82rem] text-foreground/75 outline-none placeholder:text-foreground/25"
          />
          {searchQuery && (
            <button
              type="button"
              className="shrink-0 cursor-pointer border-0 bg-transparent text-[0.72rem] text-faint hover:text-foreground"
              onClick={() => setSearchQuery("")}
            >
              Clear
            </button>
          )}
        </div>
        {searchQuery.trim() && isJql(searchQuery.trim()) && (
          <div className="mt-1 px-1 text-[0.7rem] text-faint">JQL mode</div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.04] px-4 py-2">
        <button
          type="button"
          className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[0.75rem] transition-colors ${
            hideDone
              ? "border-blue-400/30 bg-blue-400/10 text-blue-300"
              : "border-white/[0.08] bg-transparent text-faint hover:border-white/[0.12] hover:text-muted"
          }`}
          onClick={() => setHideDone(!hideDone)}
        >
          Hide done
        </button>
        {selectedInstanceId && (
          <AssigneeFilterPicker
            instanceId={selectedInstanceId}
            value={assigneeFilter}
            displayName={assigneeDisplayName}
            onChange={(id, name) => {
              setAssigneeFilter(id);
              setAssigneeDisplayName(name);
            }}
          />
        )}
      </div>

      {/* Content */}
      {initialLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Loader2 size={18} className="animate-spin text-faint" />
        </div>
      ) : error && issues.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="m-0 text-[0.82rem] text-foreground/40">{error}</p>
        </div>
      ) : issues.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-[0.82rem] text-faint">
          {searchQuery.trim() ? "No matching issues." : "No issues found."}
        </div>
      ) : (
        <ScrollArea className="note-scroll-area min-h-0 min-w-0 flex-1 [&_.ui-scroll-area__viewport]:overflow-x-hidden! [&_.ui-scroll-area__scrollbar--horizontal]:hidden [&_.ui-scroll-area__scrollbar--vertical]:hidden">
          <div className="flex w-full min-w-0 flex-col gap-px overflow-hidden px-4 py-2 pb-2">
            {issues.map((issue) => (
              <IssueRow key={issue.id} issue={issue} onClick={() => selectIssue(issue.key)} />
            ))}
          </div>

          <div className="flex flex-col items-center gap-2 pb-8 pt-2">
            {cursor && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleLoadMore()}
                disabled={moreLoading}
              >
                {moreLoading ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                Load more
              </Button>
            )}
            <span className="text-[0.75rem] text-faint">
              {cursor ? `${issues.length} issues loaded` : `${issues.length} issues`}
            </span>
          </div>
        </ScrollArea>
      )}

      {/* Create Issue Dialog */}
      {selectedInstanceId && selectedProjectKey && (
        <CreateIssueDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          instanceId={selectedInstanceId}
          projectKey={selectedProjectKey}
          onCreated={(issueKey) => {
            refreshIssues();
            selectIssue(issueKey);
          }}
        />
      )}
    </div>
  );
}
