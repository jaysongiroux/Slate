import { useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { addLinkwardenInstance } from "../../lib/api";

interface AddInstanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

export function AddInstanceDialog({ open, onOpenChange, onAdded }: AddInstanceDialogProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!url.trim() || !token.trim()) return;
    setSaving(true);
    setError("");
    try {
      await addLinkwardenInstance({
        url: url.trim(),
        token: token.trim(),
        name: name.trim() || undefined,
      });
      setName("");
      setUrl("");
      setToken("");
      onOpenChange(false);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Add LinkWarden Instance</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <label className="text-[0.78rem] text-muted">Name</label>
            <input
              type="text"
              placeholder="My LinkWarden"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[0.78rem] text-muted">URL</label>
            <input
              type="url"
              placeholder="https://linkwarden.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[0.78rem] text-muted">Access Token</label>
            <input
              type="password"
              placeholder="Your LinkWarden API token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
              }}
            />
          </div>
          {error && <p className="m-0 text-[0.78rem] leading-snug text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || !url.trim() || !token.trim()}
            >
              {saving ? "Connecting..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
