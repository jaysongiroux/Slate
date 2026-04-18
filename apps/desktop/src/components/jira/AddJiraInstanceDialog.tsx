import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { addJiraInstance, updateJiraInstance } from "../../lib/api";
import type { JiraInstance, JiraInstanceType } from "@slate/shared";
import { formatJiraError } from "./jira-errors";

interface AddJiraInstanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
  /** When set, the dialog is in edit mode for this instance. */
  editInstance?: JiraInstance | null;
}

export function AddJiraInstanceDialog({
  open,
  onOpenChange,
  onAdded,
  editInstance,
}: AddJiraInstanceDialogProps) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [instanceType, setInstanceType] = useState<JiraInstanceType>("cloud");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const isEditing = Boolean(editInstance);

  // Pre-fill fields when editing
  useEffect(() => {
    if (open && editInstance) {
      setName(editInstance.name);
      setBaseUrl(editInstance.baseUrl);
      setEmail(editInstance.email);
      setInstanceType(editInstance.type);
      setToken(""); // don't pre-fill token for security
      setError("");
    } else if (open && !editInstance) {
      setName("");
      setBaseUrl("");
      setEmail("");
      setToken("");
      setInstanceType("cloud");
      setError("");
    }
  }, [open, editInstance]);

  async function handleSave() {
    if (isEditing) {
      // Edit mode: only require fields that changed (token is optional)
      if (!baseUrl.trim() || !email.trim()) return;
    } else {
      // Create mode: all fields required
      if (!baseUrl.trim() || !email.trim() || !token.trim()) return;
    }

    setSaving(true);
    setError("");
    try {
      if (isEditing && editInstance) {
        await updateJiraInstance({
          id: editInstance.id,
          name: name.trim() || undefined,
          baseUrl: baseUrl.trim(),
          email: email.trim(),
          token: token.trim() || undefined, // only send if changed
          type: instanceType,
        });
      } else {
        await addJiraInstance({
          baseUrl: baseUrl.trim(),
          email: email.trim(),
          token: token.trim(),
          type: instanceType,
          name: name.trim() || undefined,
        });
      }
      onOpenChange(false);
      onAdded();
    } catch (err) {
      setError(formatJiraError(err, "Failed to connect."));
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = isEditing
    ? Boolean(baseUrl.trim() && email.trim())
    : Boolean(baseUrl.trim() && email.trim() && token.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Jira Instance" : "Add Jira Instance"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Name</label>
            <input
              type="text"
              placeholder="My Jira"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
              autoFocus
            />
          </div>
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Base URL</label>
            <input
              type="url"
              placeholder="https://yourcompany.atlassian.net"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
            />
          </div>
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Email</label>
            <input
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
            />
          </div>
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">
              API Token{isEditing ? " (leave blank to keep current)" : ""}
            </label>
            <input
              type="password"
              placeholder={isEditing ? "Leave blank to keep current token" : "Your Jira API token"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
              }}
            />
          </div>
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Instance Type</label>
            <select
              value={instanceType}
              onChange={(e) => setInstanceType(e.target.value as JiraInstanceType)}
              className="appearance-none rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none focus:border-white/[0.15]"
            >
              <option value="cloud">Cloud</option>
              <option value="server">Server / Data Center</option>
            </select>
          </div>
          {error && <p className="m-0 text-[0.78rem] leading-snug text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || !canSubmit}
            >
              {saving ? "Saving..." : isEditing ? "Save" : "Connect"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
