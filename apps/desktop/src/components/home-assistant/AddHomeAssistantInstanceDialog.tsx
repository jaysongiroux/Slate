import { useEffect, useState } from "react";
import { addHomeAssistantInstance } from "../../lib/api";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { formatHomeAssistantUiError } from "./home-assistant-errors";

interface AddHomeAssistantInstanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

export function AddHomeAssistantInstanceDialog({
  open,
  onOpenChange,
  onAdded,
}: AddHomeAssistantInstanceDialogProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setUrl("");
    setToken("");
    setError("");
    setSaving(false);
  }, [open]);

  async function handleSave() {
    if (!url.trim() || !token.trim()) return;
    setSaving(true);
    setError("");
    try {
      await addHomeAssistantInstance({
        url: url.trim(),
        token: token.trim(),
        name: name.trim() || undefined,
      });
      onOpenChange(false);
      onAdded();
    } catch (err) {
      setError(formatHomeAssistantUiError(err, "Failed to connect to Home Assistant."));
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = Boolean(url.trim() && token.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Add Home Assistant Instance</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <label className="text-[0.78rem] text-muted">Name</label>
            <input
              type="text"
              placeholder="Home"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[0.78rem] text-muted">URL</label>
            <input
              type="url"
              placeholder="https://homeassistant.local:8123"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[0.78rem] text-muted">Long-lived access token</label>
            <input
              type="password"
              placeholder="Paste a Home Assistant token"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleSave();
              }}
            />
          </div>
          {error ? <p className="m-0 text-[0.78rem] leading-snug text-red-400">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving || !canSubmit}>
              {saving ? "Connecting..." : "Connect"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
