import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { JiraIssue, JiraUser } from "@slate/shared";
import { updateJiraIssue, searchJiraUsers } from "../../lib/api";
import { formatJiraError } from "./jira-errors";

export function AssigneePicker({ issue, instanceId, onSaved }: {
  issue: JiraIssue;
  instanceId: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<JiraUser[]>([]);
  const [loading, setLoading] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number>(0);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    const h = (e: MouseEvent) => {
      if (buttonRef.current?.contains(e.target as Node)) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
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

  async function handleSelect(user: JiraUser | null) {
    setOpen(false);
    try {
      await updateJiraIssue({ instanceId, issueKey: issue.key, fields: { assigneeId: user?.accountId ?? "" } });
      onSaved();
    } catch (err) {
      toast.error(formatJiraError(err, "Failed to update assignee."));
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="flex cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-[0.85rem] text-muted transition-colors hover:bg-white/[0.04]"
        onClick={() => setOpen(!open)}
      >
        {issue.assignee ? (
          <>
            {issue.assignee.avatarUrl && <img src={issue.assignee.avatarUrl} alt="" className="size-5 rounded-full" />}
            <span className="truncate">{issue.assignee.displayName}</span>
          </>
        ) : (
          <span className="text-faint">Unassigned</span>
        )}
      </button>
      {open && createPortal(
        <div ref={menuRef} className="fixed z-[9999] w-[240px] rounded-lg border border-white/[0.08] bg-[#1c1c1e] shadow-xl" style={{ top: pos.top, left: pos.left }}>
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
              onClick={() => void handleSelect(null)}
            >
              Unassigned
            </button>
            {loading ? (
              <div className="flex justify-center py-2"><Loader2 size={14} className="animate-spin text-faint" /></div>
            ) : users.map((u) => (
              <button
                key={u.accountId}
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-[0.82rem] text-muted hover:bg-white/[0.06] hover:text-foreground"
                onClick={() => void handleSelect(u)}
              >
                {u.avatarUrl && <img src={u.avatarUrl} alt="" className="size-5 rounded-full" />}
                <span className="truncate">{u.displayName}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
