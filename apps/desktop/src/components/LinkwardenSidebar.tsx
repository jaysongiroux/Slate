import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  Link,
  Loader2,
  LogIn,
  Plus,
  WifiOff,
} from "lucide-react";
import type { LinkwardenCollection, LinkwardenTag } from "@slate/shared";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import {
  getLinkwardenInstances,
  getLinkwardenCollections,
  getLinkwardenTags,
  removeLinkwardenInstance,
  showContextMenu,
} from "../lib/api";
import { useLinkwardenStore } from "../stores/linkwarden-store";
import { useUiStore } from "../stores/ui-store";
import type { LinkwardenInstance } from "@slate/shared";

interface LinkwardenSidebarProps {
  backendReachable: boolean;
  backendAuthenticated: boolean;
  refreshSignal?: number;
  onOpenSettings: () => void;
}

export function LinkwardenSidebar({
  backendReachable,
  backendAuthenticated,
  refreshSignal = 0,
  onOpenSettings,
}: LinkwardenSidebarProps) {
  const [instances, setInstances] = useState<LinkwardenInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedInstances, setExpandedInstances] = useState<Set<string>>(new Set());
  const [collectionsByInstance, setCollectionsByInstance] = useState<
    Record<string, LinkwardenCollection[]>
  >({});
  const [tagsByInstance, setTagsByInstance] = useState<Record<string, LinkwardenTag[]>>({});
  const [loadingInstances, setLoadingInstances] = useState<Set<string>>(new Set());

  const selectedInstanceId = useLinkwardenStore((s) => s.selectedInstanceId);
  const setSelectedInstanceId = useLinkwardenStore((s) => s.setSelectedInstanceId);
  const selectedCollectionId = useLinkwardenStore((s) => s.selectedCollectionId);
  const setSelectedCollectionId = useLinkwardenStore((s) => s.setSelectedCollectionId);
  const selectedTagId = useLinkwardenStore((s) => s.selectedTagId);
  const setSelectedTagId = useLinkwardenStore((s) => s.setSelectedTagId);
  const view = useLinkwardenStore((s) => s.view);
  const setView = useLinkwardenStore((s) => s.setView);
  const setAddInstanceOpen = useUiStore((s) => s.setAddLinkwardenInstanceOpen);

  const refresh = useCallback(async () => {
    if (!backendAuthenticated) {
      setInstances([]);
      setLoading(false);
      return;
    }
    try {
      const result = await getLinkwardenInstances();
      setInstances(result.instances);
      if (!selectedInstanceId && result.instances.length > 0) {
        setSelectedInstanceId(result.instances[0].id);
      }
    } catch {
      setInstances([]);
    } finally {
      setLoading(false);
    }
  }, [backendAuthenticated, selectedInstanceId, setSelectedInstanceId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (refreshSignal > 0) void refresh();
  }, [refreshSignal, refresh]);

  async function toggleExpanded(instanceId: string) {
    const next = new Set(expandedInstances);
    if (next.has(instanceId)) {
      next.delete(instanceId);
      setExpandedInstances(next);
      return;
    }

    next.add(instanceId);
    setExpandedInstances(next);

    if (collectionsByInstance[instanceId]) return;

    setLoadingInstances((prev) => new Set([...prev, instanceId]));
    try {
      const [collectionsRes, tagsRes] = await Promise.all([
        getLinkwardenCollections({ instanceId }),
        getLinkwardenTags({ instanceId }),
      ]);
      setCollectionsByInstance((prev) => ({
        ...prev,
        [instanceId]: collectionsRes.response ?? [],
      }));
      setTagsByInstance((prev) => ({
        ...prev,
        [instanceId]: tagsRes.response ?? [],
      }));
    } finally {
      setLoadingInstances((prev) => {
        const next = new Set(prev);
        next.delete(instanceId);
        return next;
      });
    }
  }

  function handleSelectInstance(instanceId: string) {
    setSelectedInstanceId(instanceId);
  }

  async function handleInstanceContextMenu(event: React.MouseEvent, instanceId: string) {
    event.preventDefault();
    const selected = await showContextMenu([{ id: "remove", label: "Remove Instance" }]);
    if (selected === "remove") {
      await removeLinkwardenInstance({ id: instanceId });
      if (selectedInstanceId === instanceId) {
        setSelectedInstanceId(null);
      }
      await refresh();
    }
  }

  if (!backendReachable || !backendAuthenticated) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-white/[0.06]">
          {!backendReachable ? (
            <WifiOff size={18} className="text-faint" />
          ) : (
            <LogIn size={18} className="text-faint" />
          )}
        </div>
        <p className="m-0 text-[0.85rem] leading-snug text-muted">
          {!backendReachable
            ? "LinkWarden requires a backend connection."
            : "Sign in to your backend to use LinkWarden."}
        </p>
        <Button size="sm" variant="secondary" onClick={onOpenSettings}>
          {!backendReachable ? "Connect backend" : "Sign in"}
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 size={18} className="animate-spin text-faint" />
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-white/[0.06]">
          <Link size={18} className="text-faint" />
        </div>
        <p className="m-0 text-[0.85rem] leading-snug text-muted">
          Add a LinkWarden instance to get started.
        </p>
        <Button size="sm" variant="secondary" onClick={() => setAddInstanceOpen(true)}>
          Add instance
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1.5 flex w-full items-center justify-between">
        <span
          className="text-[0.9rem] font-normal tracking-wide text-foreground"
          style={{ userSelect: "none" }}
        >
          LinkWarden
        </span>
        <button
          type="button"
          className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
          aria-label="Add instance"
          onClick={() => setAddInstanceOpen(true)}
        >
          <Plus size={14} />
        </button>
      </div>

      <ScrollArea className="note-scroll-area flex min-h-0 flex-1 flex-col [&_.ui-scroll-area__viewport]:overflow-x-hidden! [&_.ui-scroll-area__scrollbar--horizontal]:hidden [&_.ui-scroll-area__scrollbar--vertical]:hidden">
        <div className="flex flex-col gap-0.5 pr-2 pb-3">
          {instances.map((instance) => (
            <div key={instance.id} className="flex flex-col gap-0.5">
              <button
                type="button"
                className={`flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] hover:bg-white/[0.06] ${
                  selectedInstanceId === instance.id ? "text-foreground" : "text-muted"
                }`}
                onClick={() => {
                  handleSelectInstance(instance.id);
                  void toggleExpanded(instance.id);
                }}
                onContextMenu={(event) => void handleInstanceContextMenu(event, instance.id)}
              >
                {expandedInstances.has(instance.id) ? (
                  <ChevronDown size={12} className="text-faint" />
                ) : (
                  <ChevronRight size={12} className="text-faint" />
                )}
                <Link size={13} className="text-faint" />
                <span className="min-w-0 flex-1 truncate select-none">{instance.name}</span>
              </button>

              <AnimatePresence initial={false}>
                {expandedInstances.has(instance.id) && (
                  <motion.div
                    key="instance-details"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="ml-2 flex flex-col gap-1 overflow-hidden"
                  >
                    {loadingInstances.has(instance.id) ? (
                      <div className="flex items-center gap-2 px-1.5 py-1 text-[0.8rem] text-faint select-none">
                        <Loader2 size={12} className="animate-spin" />
                        Loading...
                      </div>
                    ) : (
                      <>
                        {/* Dashboard */}
                        <button
                          type="button"
                          className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md border-0 px-2 py-1 text-left text-[0.78rem] ${
                            selectedInstanceId === instance.id &&
                            view === "dashboard" &&
                            selectedCollectionId == null &&
                            selectedTagId == null
                              ? "bg-white/[0.05] text-foreground"
                              : "bg-transparent text-muted hover:bg-white/[0.04]"
                          }`}
                          onClick={() => {
                            handleSelectInstance(instance.id);
                            setView("dashboard");
                          }}
                        >
                          <LayoutDashboard size={12} className="shrink-0 text-faint" />
                          <span>Dashboard</span>
                        </button>

                        {/* Collections */}
                        <div>
                          <div className="px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint select-none">
                            Collections
                          </div>
                          <div className="flex flex-col gap-px">
                            {(collectionsByInstance[instance.id] ?? []).map((collection) => (
                              <button
                                key={collection.id}
                                type="button"
                                className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md border-0 px-2 py-1 text-left text-[0.78rem] ${
                                  selectedInstanceId === instance.id &&
                                  selectedCollectionId === collection.id
                                    ? "bg-white/[0.05] text-foreground"
                                    : "bg-transparent text-muted hover:bg-white/[0.04]"
                                }`}
                                onClick={() => {
                                  handleSelectInstance(instance.id);
                                  setSelectedCollectionId(collection.id);
                                }}
                              >
                                <div
                                  className="size-[7px] shrink-0 rounded-sm"
                                  style={{
                                    backgroundColor: collection.color
                                      ? `${collection.color}66`
                                      : "rgba(255,255,255,0.15)",
                                  }}
                                />
                                <span className="min-w-0 flex-1 truncate">{collection.name}</span>
                                {collection._count?.links != null && (
                                  <span className="text-[0.7rem] text-faint">
                                    {collection._count.links}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Tags */}
                        {(tagsByInstance[instance.id] ?? []).length > 0 && (
                          <div>
                            <div className="px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint select-none">
                              Tags
                            </div>
                            <div className="flex flex-wrap gap-1 px-2 py-0.5">
                              {(tagsByInstance[instance.id] ?? []).map((tag) => (
                                <button
                                  key={tag.id}
                                  type="button"
                                  className={`cursor-pointer rounded-[10px] border px-2 py-0.5 text-[0.7rem] transition-colors ${
                                    selectedInstanceId === instance.id && selectedTagId === tag.id
                                      ? "border-white/[0.12] bg-white/[0.08] text-foreground"
                                      : "border-white/[0.06] bg-white/[0.03] text-muted hover:bg-white/[0.06]"
                                  }`}
                                  onClick={() => {
                                    handleSelectInstance(instance.id);
                                    setSelectedTagId(tag.id);
                                  }}
                                >
                                  {tag.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
