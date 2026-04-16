import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import type { LinkwardenCollection, LinkwardenTag } from "@slate/shared";
import { createLinkwardenLink, getLinkwardenCollections, getLinkwardenTags } from "../../lib/api";
import { useLinkwardenStore } from "../../stores/linkwarden-store";

interface AddLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

export function AddLinkDialog({ open, onOpenChange, onAdded }: AddLinkDialogProps) {
  const selectedInstanceId = useLinkwardenStore((s) => s.selectedInstanceId);

  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | "">("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [collections, setCollections] = useState<LinkwardenCollection[]>([]);
  const [tags, setTags] = useState<LinkwardenTag[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !selectedInstanceId) return;
    void Promise.all([
      getLinkwardenCollections({ instanceId: selectedInstanceId }),
      getLinkwardenTags({ instanceId: selectedInstanceId }),
    ]).then(([collectionsRes, tagsRes]) => {
      setCollections(collectionsRes.response ?? []);
      setTags(tagsRes.response ?? []);
    });
  }, [open, selectedInstanceId]);

  function handleReset() {
    setUrl("");
    setName("");
    setDescription("");
    setSelectedCollectionId("");
    setSelectedTags([]);
    setError("");
  }

  function toggleTag(tagName: string) {
    setSelectedTags((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName],
    );
  }

  async function handleSave() {
    if (!url.trim() || !selectedInstanceId) return;
    setSaving(true);
    setError("");
    try {
      await createLinkwardenLink({
        instanceId: selectedInstanceId,
        url: url.trim(),
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        collection: selectedCollectionId ? { id: Number(selectedCollectionId) } : undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      });
      handleReset();
      onOpenChange(false);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save link.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleReset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="glass-popover max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Save Link</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <label className="text-[0.78rem] text-muted">URL</label>
            <input
              type="url"
              placeholder="https://..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[0.78rem] text-muted">Name (optional)</label>
            <input
              type="text"
              placeholder="Page title"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[0.78rem] text-muted">Description (optional)</label>
            <textarea
              placeholder="Notes about this link"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
            />
          </div>
          {collections.length > 0 && (
            <div className="grid gap-1.5">
              <label className="text-[0.78rem] text-muted">Collection</label>
              <select
                value={selectedCollectionId}
                onChange={(e) =>
                  setSelectedCollectionId(e.target.value ? Number(e.target.value) : "")
                }
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[0.85rem] text-foreground outline-none focus:border-white/[0.15]"
              >
                <option value="">None</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {tags.length > 0 && (
            <div className="grid gap-1.5">
              <label className="text-[0.78rem] text-muted">Tags</label>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className={`cursor-pointer rounded-[10px] border px-2 py-0.5 text-[0.72rem] transition-colors ${
                      selectedTags.includes(tag.name)
                        ? "border-white/[0.15] bg-white/[0.1] text-foreground"
                        : "border-white/[0.06] bg-white/[0.03] text-muted hover:bg-white/[0.06]"
                    }`}
                    onClick={() => toggleTag(tag.name)}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <p className="m-0 text-[0.78rem] leading-snug text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                handleReset();
                onOpenChange(false);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving || !url.trim()}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
