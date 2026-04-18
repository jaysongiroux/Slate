import type { JiraIssue } from "@slate/shared";
import { cn } from "../../lib/utils";

interface IssueRowProps {
  issue: JiraIssue;
  selected?: boolean;
  onClick: () => void;
}

function statusColor(category: string): string {
  switch (category) {
    case "todo":
      return "border-white/[0.1] bg-white/[0.04] text-muted";
    case "in_progress":
      return "border-blue-400/30 bg-blue-400/10 text-blue-300";
    case "done":
      return "border-green-400/30 bg-green-400/10 text-green-300";
    default:
      return "border-white/[0.08] bg-white/[0.03] text-faint";
  }
}

export function IssueRow({ issue, selected, onClick }: IssueRowProps) {
  return (
    <div
      className="min-w-0 cursor-pointer rounded-md px-2.5"
      style={{ overflow: "hidden", maxWidth: "100%" }}
      onClick={onClick}
    >
      <div
        className={cn(
          "flex items-center gap-2 rounded-md py-1.5 text-[0.82rem] transition-colors",
          selected
            ? "text-foreground"
            : "text-muted hover:text-foreground/80",
        )}
        style={{ minWidth: 0, overflow: "hidden" }}
      >
        {/* Issue type icon */}
        {issue.issueType.iconUrl ? (
          <img
            src={issue.issueType.iconUrl}
            alt={issue.issueType.name}
            className="size-4 shrink-0 rounded-sm"
          />
        ) : (
          <div className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-white/[0.06] text-[0.6rem] text-faint">
            {issue.issueType.name.charAt(0)}
          </div>
        )}

        {/* Key */}
        <span style={{ flexShrink: 0 }} className="text-[0.75rem] font-medium text-faint">
          {issue.key}
        </span>

        {/* Summary */}
        <span
          style={{
            flex: "1 1 0",
            width: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {issue.summary}
        </span>

        {/* Status badge */}
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[0.68rem] leading-tight",
            statusColor(issue.status.statusCategory),
          )}
          style={{ whiteSpace: "nowrap" }}
        >
          {issue.status.name}
        </span>

        {/* Priority icon */}
        {issue.priority?.iconUrl ? (
          <img
            src={issue.priority.iconUrl}
            alt={issue.priority.name}
            className="size-3.5 shrink-0"
          />
        ) : null}

        {/* Assignee avatar */}
        {issue.assignee ? (
          issue.assignee.avatarUrl ? (
            <img
              src={issue.assignee.avatarUrl}
              alt={issue.assignee.displayName}
              className="size-5 shrink-0 rounded-full"
              title={issue.assignee.displayName}
            />
          ) : (
            <div
              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[0.6rem] text-faint"
              title={issue.assignee.displayName}
            >
              {issue.assignee.displayName.charAt(0)}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
