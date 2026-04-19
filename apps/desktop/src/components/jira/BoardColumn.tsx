import { useDroppable } from "@dnd-kit/core";
import type { JiraBoardColumn, JiraIssue } from "@slate/shared";
import { cn } from "../../lib/utils";
import { BoardCard } from "./BoardCard";

interface BoardColumnProps {
  column: JiraBoardColumn;
  issues: JiraIssue[];
  onIssueClick: (issueKey: string) => void;
}

function columnHeaderColor(statuses: { statusCategory: string }[]): string {
  // Use the dominant status category for the column header accent
  const cats = statuses.map((s) => s.statusCategory);
  if (cats.includes("done")) return "bg-green-400/20 text-green-300";
  if (cats.includes("in_progress")) return "bg-blue-400/20 text-blue-300";
  return "bg-white/[0.06] text-muted";
}

export function BoardColumn({ column, issues, onIssueClick }: BoardColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: column.name });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-xl border border-white/[0.04] bg-white/[0.02] transition-colors",
        isOver && "border-blue-400/30 bg-blue-400/[0.04]",
      )}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[0.7rem] font-medium",
            columnHeaderColor(column.statuses),
          )}
        >
          {column.name}
        </span>
        <span className="text-[0.7rem] text-faint">{issues.length}</span>
      </div>

      {/* Cards */}
      <div className="flex min-h-[60px] flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
        {issues.map((issue) => (
          <BoardCard key={issue.key} issue={issue} onClick={() => onIssueClick(issue.key)} />
        ))}
      </div>
    </div>
  );
}
