import { useEffect, useState } from "react";
import type { ForgeInstance } from "@slate/shared";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { addForgeInstance, getForgeInstances, updateForgeInstance } from "../../lib/api";
import { useUiStore } from "../../stores/ui-store";
import { useForgeStore } from "../../stores/forge-store";

const DEFAULT_BASE_URLS: Record<"github" | "gitlab", string> = {
  github: "https://api.github.com",
  gitlab: "https://gitlab.com/api/v4",
};

const SCOPE_HINTS: Record<"github" | "gitlab", string> = {
  github: "Needs scopes: repo, read:org, notifications. Fine-grained tokens also work.",
  gitlab: "Needs scopes: read_api, read_user.",
};

const fieldClass =
  "rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]";

export function AddForgeInstanceDialog({ onChanged }: { onChanged?: () => void }) {
  const addOpen = useUiStore((s) => s.addForgeInstanceOpen);
  const setAddOpen = useUiStore((s) => s.setAddForgeInstanceOpen);
  const editingId = useUiStore((s) => s.editingForgeInstanceId);
  const setEditingId = useUiStore((s) => s.setEditingForgeInstanceId);
  const setSelectedInstanceId = useForgeStore((s) => s.setSelectedInstanceId);

  const [editInstance, setEditInstance] = useState<ForgeInstance | null>(null);
  const [provider, setProvider] = useState<"github" | "gitlab">("github");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URLS.github);
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const isEditing = Boolean(editingId);
  const open = addOpen || isEditing;

  // Load the instance being edited
  useEffect(() => {
    if (!editingId) {
      setEditInstance(null);
      return;
    }
    void getForgeInstances().then(({ instances }) => {
      const found = instances.find((i) => i.id === editingId) ?? null;
      setEditInstance(found);
      if (found) {
        setProvider(found.provider);
        setBaseUrl(found.baseUrl);
        setName(found.name);
        setToken("");
        setError("");
      }
    });
  }, [editingId]);

  // Reset fields when opening add mode
  useEffect(() => {
    if (addOpen && !editingId) {
      setProvider("github");
      setBaseUrl(DEFAULT_BASE_URLS.github);
      setToken("");
      setName("");
      setError("");
    }
  }, [addOpen, editingId]);

  function onProviderChange(next: "github" | "gitlab") {
    if (isEditing) return; // provider is immutable when editing
    setProvider(next);
    setBaseUrl(DEFAULT_BASE_URLS[next]);
  }

  function close() {
    setAddOpen(false);
    setEditingId(null);
  }

  function onOpenChange(next: boolean) {
    if (!next) close();
  }

  async function handleSave() {
    if (!baseUrl.trim()) return;
    if (!isEditing && !token.trim()) return;
    setSaving(true);
    setError("");
    try {
      if (isEditing && editInstance) {
        const result = await updateForgeInstance({
          id: editInstance.id,
          name: name.trim() || undefined,
          baseUrl: baseUrl.trim(),
          token: token.trim() || undefined,
        });
        setSelectedInstanceId(result.instance.id);
      } else {
        const result = await addForgeInstance({
          provider,
          baseUrl: baseUrl.trim(),
          token: token.trim(),
          name: name.trim() || undefined,
        });
        setSelectedInstanceId(result.instance.id);
      }
      close();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save account.");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = isEditing
    ? Boolean(baseUrl.trim())
    : Boolean(baseUrl.trim() && token.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit GitHub / GitLab account" : "Add GitHub or GitLab account"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Provider</label>
            <div className="flex gap-3 text-[0.85rem] text-foreground">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="forge-provider"
                  value="github"
                  checked={provider === "github"}
                  onChange={() => onProviderChange("github")}
                  disabled={isEditing}
                />
                GitHub
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="forge-provider"
                  value="gitlab"
                  checked={provider === "gitlab"}
                  onChange={() => onProviderChange("gitlab")}
                  disabled={isEditing}
                />
                GitLab
              </label>
            </div>
            {isEditing && (
              <span className="text-[0.72rem] text-faint">
                Provider can&apos;t be changed. Remove and re-add to switch providers.
              </span>
            )}
          </div>

          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Base URL</label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">
              Token{isEditing ? " (leave blank to keep current)" : ""}
            </label>
            <input
              type="password"
              placeholder={
                isEditing ? "Leave blank to keep current token" : "Personal access token"
              }
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className={fieldClass}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
              }}
            />
            <span className="text-[0.72rem] text-faint">{SCOPE_HINTS[provider]}</span>
          </div>

          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Name (optional)</label>
            <input
              type="text"
              placeholder="e.g., Work"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldClass}
            />
          </div>

          {error && <p className="m-0 text-[0.78rem] leading-snug text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving || !canSubmit}>
              {saving ? (isEditing ? "Saving..." : "Connecting...") : isEditing ? "Save" : "Connect"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
