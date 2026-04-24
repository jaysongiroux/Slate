import type { ForgeIssue } from "@slate/shared";
import { openExternal, showContextMenu } from "../../lib/api";

interface Props {
  issue: ForgeIssue;
  showRepo?: boolean;
  onPin?: () => void;
  onStarRepo?: () => void;
}

function relativeAge(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return "now";
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  return `${mo}mo`;
}

export function ForgeIssueRow({ issue, showRepo = true, onPin, onStarRepo }: Props) {
  async function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const items = [
      { id: "open", label: "Open in browser" },
      { id: "copy", label: "Copy URL" },
      { id: "pin", label: "Pin" },
    ];
    if (onStarRepo) items.push({ id: "star", label: "Star repo" });
    const choice = await showContextMenu(items);
    if (choice === "open") await openExternal(issue.webUrl);
    if (choice === "copy") await navigator.clipboard.writeText(issue.webUrl);
    if (choice === "pin") onPin?.();
    if (choice === "star") onStarRepo?.();
  }

  return (
    <div
      className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[0.84rem] text-muted hover:bg-white/[0.04]"
      onClick={() => void openExternal(issue.webUrl)}
      onContextMenu={onContextMenu}
    >
      <span className="shrink-0 font-mono text-[0.74rem] text-faint">#{issue.number}</span>
      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
      {showRepo && <span className="shrink-0 text-[0.72rem] text-faint">{issue.repo}</span>}
      <span className="shrink-0 text-[0.72rem] text-faint">{relativeAge(issue.updatedAt)}</span>
    </div>
  );
}
