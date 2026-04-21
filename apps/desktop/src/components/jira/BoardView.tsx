import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { JiraBoardColumn, JiraIssue, JiraTransition } from "@slate/shared";
import {
  getJiraBoardConfig,
  getJiraBoardIssues,
  getJiraSprintIssues,
  getJiraTransitions,
  transitionJiraIssue,
} from "../../lib/api";
import { useJiraStore } from "../../stores/jira-store";
import { formatJiraError } from "./jira-errors";
import { BoardColumn } from "./BoardColumn";
import { BoardCard } from "./BoardCard";

export function BoardView() {
  const instanceId = useJiraStore((s) => s.selectedInstanceId)!;
  const boardId = useJiraStore((s) => s.selectedBoardId)!;
  const sprintId = useJiraStore((s) => s.selectedSprintId);
  const setSelectedIssueKey = useJiraStore((s) => s.setSelectedIssueKey);

  const [columns, setColumns] = useState<JiraBoardColumn[]>([]);
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIssueKey, setActiveIssueKey] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);

  // Cache transitions per issue key so we don't re-fetch on every drag
  const transitionsCache = useRef<Record<string, JiraTransition[]>>({});

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configRes, issuesRes] = await Promise.all([
        getJiraBoardConfig({ instanceId, boardId }),
        sprintId
          ? getJiraSprintIssues({ instanceId, sprintId })
          : getJiraBoardIssues({ instanceId, boardId }),
      ]);
      setColumns(configRes.columns);
      setIssues(issuesRes.issues);
      transitionsCache.current = {};
    } catch (err) {
      setError(formatJiraError(err, "Failed to load board."));
    } finally {
      setLoading(false);
    }
  }, [instanceId, boardId, sprintId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Map status IDs to column names for fast lookup
  const statusToColumn = useMemo(() => {
    const map = new Map<string, string>();
    for (const col of columns) {
      for (const status of col.statuses) {
        map.set(status.id, col.name);
      }
    }
    return map;
  }, [columns]);

  // Group issues by column
  const issuesByColumn = useMemo(() => {
    const grouped = new Map<string, JiraIssue[]>();
    for (const col of columns) {
      grouped.set(col.name, []);
    }
    for (const issue of issues) {
      const colName = statusToColumn.get(issue.status.id);
      if (colName && grouped.has(colName)) {
        grouped.get(colName)!.push(issue);
      }
    }
    return grouped;
  }, [columns, issues, statusToColumn]);

  const activeIssue = activeIssueKey
    ? (issues.find((i) => i.key === activeIssueKey) ?? null)
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveIssueKey(String(event.active.id));
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveIssueKey(null);
    const { active, over } = event;
    if (!over) return;

    const issueKey = String(active.id);
    const targetColumnName = String(over.id);
    const issue = issues.find((i) => i.key === issueKey);
    if (!issue) return;

    // Check if already in target column
    const currentColumn = statusToColumn.get(issue.status.id);
    if (currentColumn === targetColumnName) return;

    // Find target column's status IDs
    const targetColumn = columns.find((c) => c.name === targetColumnName);
    if (!targetColumn || targetColumn.statuses.length === 0) return;
    const targetStatusIds = new Set(targetColumn.statuses.map((s) => s.id));

    setTransitioning(issueKey);
    try {
      // Fetch transitions if not cached
      if (!transitionsCache.current[issueKey]) {
        const res = await getJiraTransitions({ instanceId, issueKey });
        transitionsCache.current[issueKey] = res.transitions;
      }
      const transitions = transitionsCache.current[issueKey];

      // Find a transition that lands in one of the target column's statuses
      const transition = transitions.find((t) => targetStatusIds.has(t.to.id));
      if (!transition) {
        toast.error(`No transition available to move to "${targetColumnName}".`);
        return;
      }

      // Check if transition has required fields
      if (transition.fields && transition.fields.length > 0) {
        toast.error(
          `Transition "${transition.name}" requires additional fields. Use the issue detail view to transition.`,
        );
        return;
      }

      // Optimistic update
      setIssues((prev) =>
        prev.map((i) => (i.key === issueKey ? { ...i, status: transition.to } : i)),
      );

      await transitionJiraIssue({
        instanceId,
        issueKey,
        transitionId: transition.id,
      });

      // Clear cached transitions since status changed
      delete transitionsCache.current[issueKey];
    } catch (err) {
      toast.error(formatJiraError(err, "Failed to transition issue."));
      // Revert optimistic update
      void fetchData();
    } finally {
      setTransitioning(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 size={18} className="animate-spin text-faint" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="m-0 text-[0.85rem] text-red-400">{error}</p>
        <button
          type="button"
          className="cursor-pointer rounded-md border-0 bg-white/[0.06] px-3 py-1 text-[0.8rem] text-muted hover:bg-white/[0.1]"
          onClick={() => void fetchData()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[0.85rem] text-faint">
        No columns configured for this board.
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {columns.map((col) => (
          <BoardColumn
            key={col.name}
            column={col}
            issues={issuesByColumn.get(col.name) ?? []}
            onIssueClick={(key) => setSelectedIssueKey(key)}
          />
        ))}
      </div>

      <DragOverlay>
        {activeIssue ? (
          <div className="w-64">
            <BoardCard issue={activeIssue} onClick={() => {}} />
          </div>
        ) : null}
      </DragOverlay>

      {/* Transitioning indicator */}
      {transitioning && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/80 px-3 py-1.5 text-[0.75rem] text-muted shadow-lg">
          <Loader2 size={12} className="mr-1.5 inline animate-spin" />
          Moving {transitioning}...
        </div>
      )}
    </DndContext>
  );
}
