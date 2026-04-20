import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Clapperboard,
  Cpu,
  Home,
  HousePlug,
  LayoutDashboard,
  Loader2,
  LogIn,
  MapPin,
  Plus,
  WifiOff,
} from "lucide-react";
import type { HomeAssistantDashboardSummary, HomeAssistantInstance } from "@slate/shared";
import {
  getHomeAssistantDashboards,
  getHomeAssistantInstances,
  removeHomeAssistantInstance,
  showContextMenu,
} from "../../lib/api";
import { useHomeAssistantStore } from "../../stores/home-assistant-store";
import { useNavigationStore, type NavEntry } from "../../stores/navigation-store";
import { useUiStore } from "../../stores/ui-store";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { formatHomeAssistantUiError } from "./home-assistant-errors";
import { DeleteHomeAssistantInstanceDialog } from "./DeleteHomeAssistantInstanceDialog";
import { EditHomeAssistantInstanceDialog } from "./EditHomeAssistantInstanceDialog";

function snapshotHomeAssistantNav(): Extract<NavEntry, { type: "homeAssistant" }> {
  const s = useHomeAssistantStore.getState();
  return {
    type: "homeAssistant",
    instanceId: s.selectedInstanceId,
    browseMode: s.selectedBrowseMode,
    dashboardId: s.selectedDashboardId ?? null,
    areaId: s.selectedAreaId ?? null,
    deviceId: s.selectedDeviceId ?? null,
  };
}

function pushHomeAssistantNavigation(
  push: (entry: NavEntry) => void,
  next: Extract<NavEntry, { type: "homeAssistant" }>,
) {
  push(snapshotHomeAssistantNav());
  push(next);
}

interface HomeAssistantSidebarProps {
  backendReachable: boolean;
  backendAuthenticated: boolean;
  refreshSignal?: number;
  onOpenSettings: () => void;
}

export function HomeAssistantSidebar({
  backendReachable,
  backendAuthenticated,
  refreshSignal = 0,
  onOpenSettings,
}: HomeAssistantSidebarProps) {
  const [instances, setInstances] = useState<HomeAssistantInstance[]>([]);
  const [dashboards, setDashboards] = useState<HomeAssistantDashboardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingInstance, setEditingInstance] = useState<HomeAssistantInstance | null>(null);
  const [deletingInstance, setDeletingInstance] = useState<HomeAssistantInstance | null>(null);

  const selectedInstanceId = useHomeAssistantStore((s) => s.selectedInstanceId);
  const setSelectedInstanceId = useHomeAssistantStore((s) => s.setSelectedInstanceId);
  const selectedDashboardId = useHomeAssistantStore((s) => s.selectedDashboardId);
  const setSelectedDashboardId = useHomeAssistantStore((s) => s.setSelectedDashboardId);
  const selectedBrowseMode = useHomeAssistantStore((s) => s.selectedBrowseMode);
  const setSelectedBrowseMode = useHomeAssistantStore((s) => s.setSelectedBrowseMode);
  const setAddHomeAssistantInstanceOpen = useUiStore(
    (s) =>
      (s as unknown as { setAddHomeAssistantInstanceOpen: (open: boolean) => void })
        .setAddHomeAssistantInstanceOpen,
  );
  const pushNavigation = useNavigationStore((s) => s.push);

  const refreshInstances = useCallback(async () => {
    if (!backendAuthenticated) {
      setInstances([]);
      setLoading(false);
      return;
    }
    setError("");
    try {
      const result = await getHomeAssistantInstances();
      setInstances(result.instances);
      if (!selectedInstanceId && result.instances.length > 0) {
        setSelectedInstanceId(result.instances[0].id);
      }
    } catch (err) {
      setInstances([]);
      setError(formatHomeAssistantUiError(err, "Could not load Home Assistant instances."));
    } finally {
      setLoading(false);
    }
  }, [backendAuthenticated, selectedInstanceId, setSelectedInstanceId]);

  const handleInstanceContextMenu = useCallback(
    async (event: React.MouseEvent, instance: HomeAssistantInstance) => {
      event.preventDefault();
      const selected = await showContextMenu([
        { id: "edit", label: "Edit instance" },
        { type: "separator" },
        { id: "delete", label: "Delete instance" },
      ]);
      if (selected === "edit") {
        setEditingInstance(instance);
      } else if (selected === "delete") {
        setDeletingInstance(instance);
      }
    },
    [],
  );

  useEffect(() => {
    setLoading(true);
    void refreshInstances();
  }, [refreshInstances]);

  useEffect(() => {
    if (refreshSignal > 0) void refreshInstances();
  }, [refreshSignal, refreshInstances]);

  useEffect(() => {
    if (!selectedInstanceId) {
      setDashboards([]);
      return;
    }
    setDashboardsLoading(true);
    setError("");
    void getHomeAssistantDashboards({ instanceId: selectedInstanceId })
      .then((result) => {
        setDashboards(result.dashboards);
        if (!selectedDashboardId && result.dashboards.length > 0) {
          setSelectedDashboardId(result.dashboards[0].id);
        }
      })
      .catch((err) => {
        setDashboards([]);
        setError(formatHomeAssistantUiError(err, "Could not load dashboards."));
      })
      .finally(() => setDashboardsLoading(false));
  }, [selectedInstanceId, selectedDashboardId, setSelectedDashboardId]);

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
            ? "Home Assistant requires a backend connection."
            : "Sign in to your backend to use Home Assistant."}
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
          <HousePlug size={18} className="text-faint" />
        </div>
        <p className="m-0 text-[0.85rem] leading-snug text-muted">
          Add a Home Assistant instance to get started.
        </p>
        <Button size="sm" variant="secondary" onClick={() => setAddHomeAssistantInstanceOpen(true)}>
          Add instance
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EditHomeAssistantInstanceDialog
        open={editingInstance !== null}
        onOpenChange={(open) => {
          if (!open) setEditingInstance(null);
        }}
        instance={editingInstance}
        onUpdated={() => void refreshInstances()}
      />
      <DeleteHomeAssistantInstanceDialog
        open={deletingInstance !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingInstance(null);
        }}
        instanceName={deletingInstance?.name ?? null}
        onConfirm={async () => {
          const target = deletingInstance;
          if (!target) return;
          await removeHomeAssistantInstance({ id: target.id });
          if (selectedInstanceId === target.id) {
            setSelectedInstanceId(null);
          }
          setDeletingInstance(null);
          await refreshInstances();
        }}
      />

      <div className="mb-1.5 flex w-full items-center justify-between">
        <span className="text-[0.9rem] font-normal tracking-wide text-foreground select-none">
          Home Assistant
        </span>
        <button
          type="button"
          className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
          aria-label="Add instance"
          onClick={() => setAddHomeAssistantInstanceOpen(true)}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 pr-2 pb-3">
        <div className="flex flex-col gap-1">
          <div className="px-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint select-none">
            Instances
          </div>
          {instances.map((instance) => (
            <button
              key={instance.id}
              type="button"
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] text-muted hover:bg-white/[0.06]",
                selectedInstanceId === instance.id && "bg-white/[0.08] text-foreground",
              )}
              onClick={() => {
                pushHomeAssistantNavigation(pushNavigation, {
                  type: "homeAssistant",
                  instanceId: instance.id,
                  browseMode: "dashboards",
                  dashboardId: null,
                  areaId: null,
                  deviceId: null,
                });
                setSelectedInstanceId(instance.id);
              }}
              onContextMenu={(event) => void handleInstanceContextMenu(event, instance)}
            >
              <Home size={13} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate select-none">{instance.name}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 px-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint select-none">
            <span>Dashboards</span>
            {dashboardsLoading ? <Loader2 size={10} className="animate-spin" /> : null}
          </div>
          {dashboards.length === 0 && !dashboardsLoading ? (
            <div className="px-1.5 py-1 text-[0.78rem] text-faint">No dashboards found</div>
          ) : (
            dashboards.map((dashboard) => (
              <button
                key={dashboard.id}
                type="button"
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] text-muted hover:bg-white/[0.06]",
                  selectedDashboardId === dashboard.id &&
                    selectedBrowseMode === "dashboards" &&
                    "bg-white/[0.08] text-foreground",
                )}
                onClick={() => {
                  pushHomeAssistantNavigation(pushNavigation, {
                    type: "homeAssistant",
                    instanceId: selectedInstanceId,
                    browseMode: "dashboards",
                    dashboardId: dashboard.id,
                    areaId: null,
                    deviceId: null,
                  });
                  setSelectedDashboardId(dashboard.id);
                }}
              >
                <LayoutDashboard size={13} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate select-none">{dashboard.title}</span>
              </button>
            ))
          )}
        </div>

        <div className="flex flex-col gap-1">
          <div className="px-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint select-none">
            Browse
          </div>
          <button
            type="button"
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] text-muted hover:bg-white/[0.06]",
              selectedBrowseMode === "areas" && "bg-white/[0.08] text-foreground",
            )}
            onClick={() => {
              pushHomeAssistantNavigation(pushNavigation, {
                type: "homeAssistant",
                instanceId: selectedInstanceId,
                browseMode: "areas",
                dashboardId: selectedDashboardId ?? null,
                areaId: null,
                deviceId: null,
              });
              setSelectedBrowseMode("areas");
            }}
          >
            <MapPin size={13} className="shrink-0 text-faint" />
            <span>Areas</span>
          </button>
          <button
            type="button"
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] text-muted hover:bg-white/[0.06]",
              selectedBrowseMode === "devices" && "bg-white/[0.08] text-foreground",
            )}
            onClick={() => {
              pushHomeAssistantNavigation(pushNavigation, {
                type: "homeAssistant",
                instanceId: selectedInstanceId,
                browseMode: "devices",
                dashboardId: selectedDashboardId ?? null,
                areaId: null,
                deviceId: null,
              });
              setSelectedBrowseMode("devices");
            }}
          >
            <Cpu size={13} className="shrink-0 text-faint" />
            <span>Devices</span>
          </button>
          <button
            type="button"
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] text-muted hover:bg-white/[0.06]",
              selectedBrowseMode === "entities" && "bg-white/[0.08] text-foreground",
            )}
            onClick={() => {
              pushHomeAssistantNavigation(pushNavigation, {
                type: "homeAssistant",
                instanceId: selectedInstanceId,
                browseMode: "entities",
                dashboardId: selectedDashboardId ?? null,
                areaId: null,
                deviceId: null,
              });
              setSelectedBrowseMode("entities");
            }}
          >
            <Activity size={13} className="shrink-0 text-faint" />
            <span>Entities</span>
          </button>
          <button
            type="button"
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] text-muted hover:bg-white/[0.06]",
              selectedBrowseMode === "scenes" && "bg-white/[0.08] text-foreground",
            )}
            onClick={() => {
              pushHomeAssistantNavigation(pushNavigation, {
                type: "homeAssistant",
                instanceId: selectedInstanceId,
                browseMode: "scenes",
                dashboardId: selectedDashboardId ?? null,
                areaId: null,
                deviceId: null,
              });
              setSelectedBrowseMode("scenes");
            }}
          >
            <Clapperboard size={13} className="shrink-0 text-faint" />
            <span>Scenes</span>
          </button>
        </div>

        {error ? (
          <p className="m-0 rounded-md bg-red-500/10 px-2 py-1.5 text-[0.78rem] leading-snug text-red-300">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
