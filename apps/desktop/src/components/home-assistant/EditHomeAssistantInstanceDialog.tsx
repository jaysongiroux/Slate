import { useEffect, useMemo, useState } from "react";
import type { HomeAssistantInstance } from "@slate/shared";
import { updateHomeAssistantInstance } from "../../lib/api";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { formatHomeAssistantUiError } from "./home-assistant-errors";

export interface EditHomeAssistantInstanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instance: HomeAssistantInstance | null;
  onUpdated: () => void;
}

export function EditHomeAssistantInstanceDialog({
  open,
  onOpenChange,
  instance,
  onUpdated,
}: EditHomeAssistantInstanceDialogProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !instance) return;
    setName(instance.name ?? "");
    setUrl(instance.url ?? "");
    setToken("");
    setError("");
    setSaving(false);
  }, [open, instance]);

  const canSubmit = useMemo(() => {
    if (!instance) return false;
    return Boolean(url.trim());
  }, [instance, url]);

  async function handleSave() {
    if (!instance) return;
    if (!url.trim()) return;
    setSaving(true);
    setError("");
    try {
      await updateHomeAssistantInstance({
        id: instance.id,
        url: url.trim(),
        name: name.trim() || undefined,
        token: token.trim() || undefined,
      });
      onOpenChange(false);
      onUpdated();
    } catch (err) {
      setError(formatHomeAssistantUiError(err, "Failed to update Home Assistant instance."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Edit Home Assistant Instance</DialogTitle>
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
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleSave();
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[0.78rem] text-muted">
              Long-lived access token (leave blank to keep current)
            </label>
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
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
