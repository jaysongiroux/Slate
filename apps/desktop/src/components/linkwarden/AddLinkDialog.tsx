import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
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
    if (!open) {
      setUrl("");
      setName("");
      setDescription("");
      setSelectedCollectionId("");
      setSelectedTags([]);
      setError("");
      setSaving(false);
      return;
    }
    if (!selectedInstanceId) return;
    void Promise.all([
      getLinkwardenCollections({ instanceId: selectedInstanceId }),
      getLinkwardenTags({ instanceId: selectedInstanceId }),
    ]).then(([collectionsRes, tagsRes]) => {
      setCollections(collectionsRes.response ?? []);
      setTags(tagsRes.response ?? []);
    });
  }, [open, selectedInstanceId]);

  function toggleTag(tagName: string) {
    setSelectedTags((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName],
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim() || !selectedInstanceId || saving) return;
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
      onOpenChange(false);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save link.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader className="mb-0">
            <DialogTitle>Save Link</DialogTitle>
            <DialogDescription>Save a new link to your LinkWarden instance.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1">
            <label className="text-[0.8rem] text-muted" htmlFor="lw-url">
              URL
            </label>
            <Input
              id="lw-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              autoFocus
              variant="bordered"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[0.8rem] text-muted" htmlFor="lw-name">
              Name (optional)
            </label>
            <Input
              id="lw-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Page title"
              variant="bordered"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[0.8rem] text-muted" htmlFor="lw-desc">
              Description (optional)
            </label>
            <Input
              id="lw-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes about this link"
              variant="bordered"
            />
          </div>

          {collections.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-[0.8rem] text-muted" htmlFor="lw-collection">
                Collection
              </label>
              <select
                id="lw-collection"
                value={selectedCollectionId}
                onChange={(e) =>
                  setSelectedCollectionId(e.target.value ? Number(e.target.value) : "")
                }
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none focus:border-white/[0.15]"
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
            <div className="flex flex-col gap-1">
              <label className="text-[0.8rem] text-muted">Tags</label>
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

          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="dialog-secondary"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button variant="dialog-primary" type="submit" disabled={!url.trim() || saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
