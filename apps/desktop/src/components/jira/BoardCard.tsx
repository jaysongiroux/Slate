import { useDraggable } from "@dnd-kit/core";
import type { JiraIssue } from "@slate/shared";
import { cn } from "../../lib/utils";

interface BoardCardProps {
  issue: JiraIssue;
  onClick: () => void;
}

export function BoardCard({ issue, onClick }: BoardCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: issue.key });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "cursor-grab rounded-lg border border-white/[0.06] bg-[#1c1c1e] p-2.5 transition-shadow hover:border-white/[0.1] hover:shadow-md active:cursor-grabbing",
        isDragging && "z-50 opacity-50 shadow-xl",
      )}
      onClick={(e) => {
        // Only fire click if not dragging
        if (!isDragging) {
          e.stopPropagation();
          onClick();
        }
      }}
    >
      {/* Key + issue type */}
      <div className="mb-1 flex items-center gap-1.5">
        {issue.issueType.iconUrl ? (
          <img
            src={issue.issueType.iconUrl}
            alt={issue.issueType.name}
            className="size-3.5 shrink-0 rounded-sm"
          />
        ) : (
          <div className="flex size-3.5 shrink-0 items-center justify-center rounded-sm bg-white/[0.06] text-[0.5rem] text-faint">
            {issue.issueType.name.charAt(0)}
          </div>
        )}
        <span className="text-[0.7rem] font-medium text-faint">{issue.key}</span>
      </div>

      {/* Summary */}
      <p className="m-0 line-clamp-2 text-[0.8rem] leading-snug text-foreground/90">
        {issue.summary}
      </p>

      {/* Bottom row: priority + assignee */}
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {issue.priority?.iconUrl && (
            <img
              src={issue.priority.iconUrl}
              alt={issue.priority.name}
              className="size-3.5"
            />
          )}
        </div>
        {issue.assignee && (
          issue.assignee.avatarUrl ? (
            <img
              src={issue.assignee.avatarUrl}
              alt={issue.assignee.displayName}
              className="size-5 rounded-full"
              title={issue.assignee.displayName}
            />
          ) : (
            <div
              className="flex size-5 items-center justify-center rounded-full bg-white/[0.08] text-[0.55rem] text-faint"
              title={issue.assignee.displayName}
            >
              {issue.assignee.displayName.charAt(0)}
            </div>
          )
        )}
      </div>
    </div>
  );
}
