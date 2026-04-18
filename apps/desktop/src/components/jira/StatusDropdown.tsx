import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { JiraIssue, JiraTransition } from "@slate/shared";
import { getJiraTransitions, transitionJiraIssue } from "../../lib/api";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { DynamicField } from "./DynamicField";
import { formatJiraError } from "./jira-errors";

export function statusColor(category: string): string {
  switch (category) {
    case "todo": return "border-white/[0.1] bg-white/[0.04] text-muted";
    case "in_progress": return "border-blue-400/30 bg-blue-400/10 text-blue-300";
    case "done": return "border-green-400/30 bg-green-400/10 text-green-300";
    default: return "border-white/[0.08] bg-white/[0.03] text-faint";
  }
}

function TransitionFieldsDialog({
  open,
  onOpenChange,
  transition,
  instanceId,
  issueKey,
  onTransitioned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transition: JiraTransition | null;
  instanceId: string;
  issueKey: string;
  onTransitioned: () => void;
}) {
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) { setFieldValues({}); setError(""); }
  }, [open]);

  async function handleSubmit() {
    if (!transition) return;
    setSaving(true);
    setError("");
    try {
      const fields: Record<string, unknown> = {};
      for (const f of transition.fields ?? []) {
        const val = fieldValues[f.fieldId];
        if (val !== undefined && val !== null && val !== "") fields[f.fieldId] = val;
      }
      await transitionJiraIssue({ instanceId, issueKey, transitionId: transition.id, fields });
      onOpenChange(false);
      onTransitioned();
    } catch (err) {
      setError(formatJiraError(err, "Failed to transition issue."));
    } finally {
      setSaving(false);
    }
  }

  if (!transition) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transition to {transition.to.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          {(transition.fields ?? []).map((f) => (
            <div key={f.fieldId} className="grid gap-1">
              <label className="text-[0.78rem] text-muted">
                {f.name} {f.required && <span className="text-red-400">*</span>}
              </label>
              <DynamicField
                field={f}
                value={fieldValues[f.fieldId]}
                onChange={(val) => setFieldValues((prev) => ({ ...prev, [f.fieldId]: val }))}
              />
            </div>
          ))}
          {error && <p className="m-0 text-[0.78rem] leading-snug text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? "Transitioning..." : "Confirm"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function StatusDropdown({ issue, instanceId, onTransitioned }: {
  issue: JiraIssue;
  instanceId: string;
  onTransitioned: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [transitions, setTransitions] = useState<JiraTransition[]>([]);
  const [loading, setLoading] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [fieldsTransition, setFieldsTransition] = useState<JiraTransition | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void getJiraTransitions({ instanceId, issueKey: issue.key })
      .then((r) => setTransitions(r.transitions))
      .catch(() => setTransitions([]))
      .finally(() => setLoading(false));
  }, [open, instanceId, issue.key]);

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

  function handleClick(t: JiraTransition) {
    setOpen(false);
    if (t.fields && t.fields.length > 0) {
      setFieldsTransition(t);
    } else {
      void doTransition(t.id);
    }
  }

  async function doTransition(id: string) {
    try { await transitionJiraIssue({ instanceId, issueKey: issue.key, transitionId: id }); onTransitioned(); }
    catch (err) { toast.error(formatJiraError(err, "Failed to transition issue.")); }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={cn("cursor-pointer rounded-full border px-3 py-1 text-[0.78rem] font-medium whitespace-nowrap transition-colors hover:brightness-125", statusColor(issue.status.statusCategory))}
        onClick={() => setOpen(!open)}
      >
        {issue.status.name}
      </button>
      {open && createPortal(
        <div ref={menuRef} className="fixed z-[9999] min-w-[180px] rounded-lg border border-white/[0.08] bg-[#1c1c1e] py-1 shadow-xl" style={{ top: pos.top, left: pos.left }}>
          {loading ? (
            <div className="flex items-center justify-center py-3"><Loader2 size={14} className="animate-spin text-faint" /></div>
          ) : transitions.length === 0 ? (
            <div className="px-3 py-2 text-[0.78rem] text-faint">No transitions available</div>
          ) : transitions.map((t) => (
            <button
              key={t.id}
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-[0.82rem] text-muted hover:bg-white/[0.06] hover:text-foreground"
              onClick={() => handleClick(t)}
            >
              <span className={cn(
                "size-2 shrink-0 rounded-full",
                t.to.statusCategory === "done" && "bg-green-400",
                t.to.statusCategory === "in_progress" && "bg-blue-400",
                t.to.statusCategory === "todo" && "bg-zinc-400",
                t.to.statusCategory === "unknown" && "bg-zinc-600",
              )} />
              {t.name}
              {t.fields && t.fields.length > 0 && <span className="ml-auto text-[0.68rem] text-faint">&hellip;</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
      <TransitionFieldsDialog
        open={fieldsTransition !== null}
        onOpenChange={(o) => { if (!o) setFieldsTransition(null); }}
        transition={fieldsTransition}
        instanceId={instanceId}
        issueKey={issue.key}
        onTransitioned={onTransitioned}
      />
    </>
  );
}
