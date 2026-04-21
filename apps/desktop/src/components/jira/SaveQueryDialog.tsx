import { useEffect, useState } from "react";
import type { SavedJqlQuery } from "@slate/shared";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { addJiraSavedQuery, updateJiraSavedQuery } from "../../lib/api";
import { formatJiraError } from "./jira-errors";

interface SaveQueryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current instance ID (required when creating). */
  instanceId: string | null;
  /** When set, the dialog edits this existing query. */
  editQuery?: SavedJqlQuery | null;
  /** Pre-fill the JQL field when creating. */
  initialJql?: string;
  onSaved: (query: SavedJqlQuery) => void;
}

export function SaveQueryDialog({
  open,
  onOpenChange,
  instanceId,
  editQuery,
  initialJql,
  onSaved,
}: SaveQueryDialogProps) {
  const [name, setName] = useState("");
  const [jql, setJql] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isEditing = Boolean(editQuery);

  useEffect(() => {
    if (!open) return;
    if (editQuery) {
      setName(editQuery.name);
      setJql(editQuery.jql);
    } else {
      setName("");
      setJql(initialJql ?? "");
    }
    setError("");
  }, [open, editQuery, initialJql]);

  async function handleSave() {
    const trimmedName = name.trim();
    const trimmedJql = jql.trim();
    if (!trimmedName || !trimmedJql) return;
    if (!isEditing && !instanceId) {
      setError("No Jira instance selected.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      if (isEditing && editQuery) {
        const { query } = await updateJiraSavedQuery({
          id: editQuery.id,
          name: trimmedName,
          jql: trimmedJql,
        });
        onSaved(query);
      } else {
        const { query } = await addJiraSavedQuery({
          name: trimmedName,
          jql: trimmedJql,
          instanceId: instanceId!,
        });
        onSaved(query);
      }
      onOpenChange(false);
    } catch (err) {
      setError(formatJiraError(err, "Failed to save query."));
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = Boolean(name.trim() && jql.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Saved Query" : "Save JQL Query"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Name</label>
            <input
              type="text"
              placeholder="My Open Bugs"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
              autoFocus
            />
          </div>
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">JQL</label>
            <textarea
              placeholder='assignee = currentUser() AND status != "Done"'
              value={jql}
              onChange={(e) => setJql(e.target.value)}
              className="min-h-[96px] rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 font-mono text-[0.82rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
              rows={4}
            />
          </div>
          {error && <p className="m-0 text-[0.8rem] text-red-400">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={!canSubmit || saving}>
            {saving ? "Saving..." : isEditing ? "Save" : "Add"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
