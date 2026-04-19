import { cn } from "../../lib/utils";
import { statusColor } from "./StatusDropdown";

export function IssueRefRow({
  issueKey,
  summary,
  statusName,
  statusCategory,
  onClick,
}: {
  issueKey: string;
  summary: string;
  statusName: string;
  statusCategory: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left text-[0.82rem] hover:bg-white/[0.05]"
    >
      <span
        className={cn(
          "shrink-0 max-w-[120px] truncate rounded-full border px-2 py-0.5 text-[0.68rem] whitespace-nowrap",
          statusColor(statusCategory),
        )}
      >
        {statusName}
      </span>
      <span className="shrink-0 font-medium text-faint">{issueKey}</span>
      <span className="min-w-0 flex-1 truncate text-muted">{summary}</span>
    </button>
  );
}
