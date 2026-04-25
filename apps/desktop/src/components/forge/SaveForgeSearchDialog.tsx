import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { addForgeSavedSearch } from "../../lib/api";
import { useUiStore } from "../../stores/ui-store";
import { useForgeStore } from "../../stores/forge-store";

const fieldClass =
  "rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]";

export function SaveForgeSearchDialog({ onSaved }: { onSaved?: () => void }) {
  const open = useUiStore((s) => s.saveForgeSearchOpen);
  const setOpen = useUiStore((s) => s.setSaveForgeSearchOpen);
  const instanceId = useForgeStore((s) => s.selectedInstanceId);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<"pr" | "issue">("pr");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setKind("pr");
      setQuery("");
      setError("");
    }
  }, [open]);

  async function handleSave() {
    if (!instanceId || !name.trim() || !query.trim()) return;
    setSaving(true);
    setError("");
    try {
      await addForgeSavedSearch({
        instanceId,
        name: name.trim(),
        kind,
        query: query.trim(),
      });
      setOpen(false);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save search.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save search</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Name</label>
            <input
              type="text"
              placeholder="Waiting on me"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldClass}
              autoFocus
            />
          </div>
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Type</label>
            <div className="flex gap-3 text-[0.85rem] text-foreground">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="forge-saved-kind"
                  value="pr"
                  checked={kind === "pr"}
                  onChange={() => setKind("pr")}
                />
                Pull requests / MRs
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="forge-saved-kind"
                  value="issue"
                  checked={kind === "issue"}
                  onChange={() => setKind("issue")}
                />
                Issues
              </label>
            </div>
          </div>
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Query</label>
            <textarea
              placeholder="is:open is:pr review-requested:@me"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`${fieldClass} min-h-[72px] resize-y`}
            />
            <span className="text-[0.72rem] text-faint">
              GitHub: use search qualifiers (e.g., <code>is:open is:pr author:@me</code>). GitLab:
              use filter params (e.g., <code>state=opened&labels=backend</code>).
            </span>
          </div>
          {error && <p className="m-0 text-[0.78rem] leading-snug text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || !name.trim() || !query.trim() || !instanceId}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
