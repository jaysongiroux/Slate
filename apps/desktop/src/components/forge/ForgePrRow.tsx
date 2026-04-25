import type { ForgePullRequest } from "@slate/shared";
import { openExternal, showContextMenu } from "../../lib/api";
import { cn } from "../../lib/utils";

interface Props {
  pr: ForgePullRequest;
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

const STATE_COLORS: Record<ForgePullRequest["state"], string> = {
  open: "text-[#25BE8A]",
  draft: "text-[#70DAFF]",
  merged: "text-[#7070FF]",
  closed: "text-[#434C5E]",
};

export function ForgePrRow({ pr, showRepo = true, onPin, onStarRepo }: Props) {
  async function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const items = [
      { id: "open", label: "Open in browser" },
      { id: "copy", label: "Copy URL" },
      { id: "pin", label: "Pin" },
    ];
    if (onStarRepo) items.push({ id: "star", label: "Star repo" });
    const choice = await showContextMenu(items);
    if (choice === "open") await openExternal(pr.webUrl);
    if (choice === "copy") await navigator.clipboard.writeText(pr.webUrl);
    if (choice === "pin") onPin?.();
    if (choice === "star") onStarRepo?.();
  }

  return (
    <div
      className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[0.84rem] text-muted hover:bg-white/[0.04]"
      onClick={() => void openExternal(pr.webUrl)}
      onContextMenu={onContextMenu}
    >
      <span className={cn("shrink-0 font-mono text-[0.74rem]", STATE_COLORS[pr.state])}>
        #{pr.number}
      </span>
      <span className="min-w-0 flex-1 truncate">{pr.title}</span>
      {showRepo && <span className="shrink-0 text-[0.72rem] text-faint">{pr.repo}</span>}
      {pr.author?.avatarUrl && (
        <img
          src={pr.author.avatarUrl}
          alt={pr.author.login}
          className="size-4 shrink-0 rounded-full"
        />
      )}
      <span className="shrink-0 text-[0.72rem] text-faint">{relativeAge(pr.updatedAt)}</span>
    </div>
  );
}
