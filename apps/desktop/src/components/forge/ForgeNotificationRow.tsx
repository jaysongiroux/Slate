import type { ForgeNotification } from "@slate/shared";
import { openExternal } from "../../lib/api";

export function ForgeNotificationRow({ notification: n }: { notification: ForgeNotification }) {
  return (
    <div
      className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[0.84rem] text-muted hover:bg-white/[0.04]"
      onClick={() => void openExternal(n.webUrl)}
    >
      <span className="shrink-0 text-[0.7rem] uppercase tracking-[0.06em] text-faint">
        {n.reason.replace(/_/g, " ")}
      </span>
      <span className="min-w-0 flex-1 truncate">{n.title}</span>
      <span className="shrink-0 text-[0.72rem] text-faint">{n.repo}</span>
    </div>
  );
}
