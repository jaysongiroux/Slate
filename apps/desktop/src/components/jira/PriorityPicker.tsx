import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { JiraIssue, JiraPriority } from "@slate/shared";
import { updateJiraIssue, getJiraPriorities } from "../../lib/api";
import { formatJiraError } from "./jira-errors";

export function PriorityPicker({ issue, instanceId, onSaved }: {
  issue: JiraIssue;
  instanceId: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [priorities, setPriorities] = useState<JiraPriority[]>([]);
  const [loading, setLoading] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void getJiraPriorities({ instanceId })
      .then((r) => setPriorities(r.priorities))
      .catch(() => setPriorities([]))
      .finally(() => setLoading(false));
  }, [open, instanceId]);

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

  async function handleSelect(id: string) {
    setOpen(false);
    try {
      await updateJiraIssue({ instanceId, issueKey: issue.key, fields: { priorityId: id } });
      onSaved();
    } catch (err) {
      toast.error(formatJiraError(err, "Failed to update priority."));
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
        {issue.priority?.iconUrl && <img src={issue.priority.iconUrl} alt="" className="size-4" />}
        <span>{issue.priority?.name ?? "None"}</span>
      </button>
      {open && createPortal(
        <div ref={menuRef} className="fixed z-[9999] min-w-[160px] rounded-lg border border-white/[0.08] bg-[#1c1c1e] py-1 shadow-xl" style={{ top: pos.top, left: pos.left }}>
          {loading ? (
            <div className="flex justify-center py-2"><Loader2 size={14} className="animate-spin text-faint" /></div>
          ) : priorities.map((p) => (
            <button
              key={p.id}
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-[0.82rem] text-muted hover:bg-white/[0.06] hover:text-foreground"
              onClick={() => void handleSelect(p.id)}
            >
              {p.iconUrl && <img src={p.iconUrl} alt="" className="size-4" />}
              {p.name}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
