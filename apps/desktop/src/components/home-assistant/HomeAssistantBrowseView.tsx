import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type {
  HomeAssistantAreaSummary,
  HomeAssistantDeviceSummary,
  HomeAssistantEntitySummary,
  HomeAssistantLiveStatus,
  HomeAssistantState,
} from "@slate/shared";
import {
  getHomeAssistantAreas,
  getHomeAssistantDevices,
  getHomeAssistantEntities,
  subscribeHomeAssistantEvents,
} from "../../lib/api";
import {
  useHomeAssistantStore,
  type HomeAssistantBrowseMode,
} from "../../stores/home-assistant-store";
import { useNavigationStore } from "../../stores/navigation-store";
import {
  HomeAssistantControllableEntitiesSection,
  HomeAssistantReadOnlyEntitiesSection,
} from "./home-assistant-entity-sections";
import { formatHomeAssistantUiError } from "./home-assistant-errors";
import { HomeAssistantEntityDetailsDialog } from "./HomeAssistantEntityDetailsDialog";

interface HomeAssistantBrowseViewProps {
  instanceId: string;
  mode: HomeAssistantBrowseMode;
  refreshSignal?: number;
}

function matchesSearch(parts: unknown[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return parts.some((part) => {
    if (part === null || part === undefined) {
      return false;
    }
    return String(part).toLowerCase().includes(normalized);
  });
}

export function HomeAssistantBrowseView({
  instanceId,
  mode,
  refreshSignal = 0,
}: HomeAssistantBrowseViewProps) {
  const [areas, setAreas] = useState<HomeAssistantAreaSummary[]>([]);
  const [devices, setDevices] = useState<HomeAssistantDeviceSummary[]>([]);
  const [entities, setEntities] = useState<HomeAssistantEntitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [liveStatus, setLiveStatus] = useState<HomeAssistantLiveStatus>("connecting");
  const [detailsEntity, setDetailsEntity] = useState<HomeAssistantEntitySummary | null>(null);
  const selectedAreaId = useHomeAssistantStore((s) => s.selectedAreaId);
  const setSelectedAreaId = useHomeAssistantStore((s) => s.setSelectedAreaId);
  const selectedDeviceId = useHomeAssistantStore((s) => s.selectedDeviceId);
  const setSelectedDeviceId = useHomeAssistantStore((s) => s.setSelectedDeviceId);
  const pushNavigation = useNavigationStore((s) => s.push);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (mode === "areas") {
        const [areaResult, deviceResult, entityResult] = await Promise.all([
          getHomeAssistantAreas({ instanceId }),
          getHomeAssistantDevices({ instanceId }),
          getHomeAssistantEntities({ instanceId }),
        ]);
        setAreas(areaResult.areas);
        setDevices(deviceResult.devices);
        setEntities(entityResult.entities);
      } else if (mode === "devices") {
        const [deviceResult, entityResult] = await Promise.all([
          getHomeAssistantDevices({ instanceId }),
          getHomeAssistantEntities({ instanceId }),
        ]);
        setDevices(deviceResult.devices);
        setEntities(entityResult.entities);
      } else if (mode === "entities" || mode === "scenes") {
        const result = await getHomeAssistantEntities({ instanceId });
        setEntities(result.entities);
      }
    } catch (err) {
      setError(formatHomeAssistantUiError(err, "Could not load Home Assistant data."));
    } finally {
      setLoading(false);
    }
  }, [instanceId, mode]);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  const patchEntityState = useCallback((state?: HomeAssistantState | null) => {
    if (!state) {
      return;
    }

    setEntities((current) =>
      current.map((entity) => (entity.entityId === state.entityId ? { ...entity, state } : entity)),
    );

    setDetailsEntity((current) =>
      current && current.entityId === state.entityId ? { ...current, state } : current,
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    setLiveStatus("connecting");

    void subscribeHomeAssistantEvents({ instanceId }, (event) => {
      if (event.type === "status") {
        setLiveStatus(event.status);
      } else if (event.type === "state_changed") {
        setLiveStatus("connected");
        patchEntityState(event.state);
      } else if (event.type === "error") {
        setLiveStatus("error");
      }
    })
      .then((cleanup) => {
        if (cancelled) {
          void cleanup();
          return;
        }
        unsubscribe = cleanup;
      })
      .catch(() => {
        setLiveStatus("error");
      });

    return () => {
      cancelled = true;
      if (unsubscribe) {
        void unsubscribe();
      }
    };
  }, [instanceId, patchEntityState]);

  useEffect(() => {
    setSearchQuery("");
  }, [instanceId, mode]);

  const selectedArea = useMemo(
    () => areas.find((area) => area.id === selectedAreaId) ?? null,
    [areas, selectedAreaId],
  );
  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );
  const title = selectedDevice
    ? selectedDevice.name
    : selectedArea
      ? selectedArea.name
      : mode.charAt(0).toUpperCase() + mode.slice(1);
  const trimmedSearchQuery = searchQuery.trim();

  const filteredAreas = useMemo(
    () => areas.filter((area) => matchesSearch([area.name, area.id], searchQuery)),
    [areas, searchQuery],
  );

  const filteredDevices = useMemo(
    () =>
      devices.filter((device) =>
        matchesSearch(
          [device.name, device.id, device.areaId, device.manufacturer, device.model],
          searchQuery,
        ),
      ),
    [devices, searchQuery],
  );

  const areaDevices = useMemo(() => {
    if (!selectedArea) {
      return [];
    }
    return devices.filter((device) => device.areaId === selectedArea.id);
  }, [devices, selectedArea]);

  const filteredAreaDevices = useMemo(
    () =>
      areaDevices.filter((device) =>
        matchesSearch([device.name, device.id, device.manufacturer, device.model], searchQuery),
      ),
    [areaDevices, searchQuery],
  );

  const browseEntities = useMemo(() => {
    if (mode === "entities") {
      return entities.filter((entity) => entity.domain !== "scene");
    }
    if (mode === "scenes") {
      return entities.filter((entity) => entity.domain === "scene");
    }
    return entities;
  }, [entities, mode]);

  const filteredEntities = useMemo(
    () =>
      browseEntities.filter((entity) =>
        matchesSearch(
          [
            entity.name,
            entity.entityId,
            entity.domain,
            entity.areaId,
            entity.deviceId,
            entity.state?.state,
          ],
          searchQuery,
        ),
      ),
    [browseEntities, searchQuery],
  );

  const deviceEntities = useMemo(() => {
    if (!selectedDevice) {
      return [];
    }
    return entities.filter(
      (entity) => entity.deviceId === selectedDevice.id && entity.domain !== "scene",
    );
  }, [entities, selectedDevice]);

  const filteredDeviceEntities = useMemo(
    () =>
      deviceEntities.filter((entity) =>
        matchesSearch(
          [entity.name, entity.entityId, entity.domain, entity.state?.state],
          searchQuery,
        ),
      ),
    [deviceEntities, searchQuery],
  );
  const controllableDeviceEntities = useMemo(
    () => filteredDeviceEntities.filter((entity) => entity.supportedControls.length > 0),
    [filteredDeviceEntities],
  );
  const readOnlyDeviceEntities = useMemo(
    () => filteredDeviceEntities.filter((entity) => entity.supportedControls.length === 0),
    [filteredDeviceEntities],
  );

  const controllableFilteredEntities = useMemo(
    () => filteredEntities.filter((entity) => entity.supportedControls.length > 0),
    [filteredEntities],
  );
  const readOnlyFilteredEntities = useMemo(
    () => filteredEntities.filter((entity) => entity.supportedControls.length === 0),
    [filteredEntities],
  );

  const visibleCount = selectedDevice
    ? filteredDeviceEntities.length
    : selectedArea
      ? filteredAreaDevices.length
      : mode === "areas"
        ? filteredAreas.length
        : mode === "devices"
          ? filteredDevices.length
          : filteredEntities.length;
  const totalCount = selectedDevice
    ? deviceEntities.length
    : selectedArea
      ? areaDevices.length
      : mode === "areas"
        ? areas.length
        : mode === "devices"
          ? devices.length
          : browseEntities.length;
  const searchPlaceholder = selectedDevice
    ? "Search device entities"
    : selectedArea
      ? "Search area devices"
      : `Search ${mode}`;
  const liveLabel =
    liveStatus === "connected"
      ? "Live"
      : liveStatus === "connecting"
        ? "Connecting"
        : liveStatus === "error"
          ? "Stream error"
          : "Offline";
  const liveClassName =
    liveStatus === "connected"
      ? "border-emerald-300/15 text-emerald-200"
      : liveStatus === "connecting"
        ? "border-white/[0.08] text-faint"
        : "border-amber-300/15 text-amber-100";

  function openDevice(device: HomeAssistantDeviceSummary) {
    pushNavigation({
      type: "homeAssistant",
      instanceId,
      browseMode: mode,
      areaId: selectedArea?.id ?? null,
      deviceId: null,
    });
    pushNavigation({
      type: "homeAssistant",
      instanceId,
      browseMode: mode,
      areaId: selectedArea?.id ?? null,
      deviceId: device.id,
    });
    setSelectedDeviceId(device.id);
    setSearchQuery("");
  }

  useEffect(() => {
    if (!selectedDevice || loading || deviceEntities.length > 0) {
      return;
    }

    console.warn("[home-assistant] selected device has no linked entities", {
      deviceId: selectedDevice.id,
      deviceName: selectedDevice.name,
      loadedEntityCount: entities.length,
      deviceLinkedEntityCount: entities.filter((entity) => Boolean(entity.deviceId)).length,
    });
  }, [deviceEntities.length, entities, loading, selectedDevice]);

  if (loading) {
    return <div className="p-8 text-sm text-faint">Loading {mode}...</div>;
  }

  if (error) {
    return <div className="p-8 text-sm text-red-300">{error}</div>;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden overflow-y-auto overflow-x-hidden px-4 py-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <div className="mb-5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="m-0 min-w-0 truncate text-xl font-semibold text-foreground">{title}</h2>
        </div>
        {selectedDevice ? (
          <div className="mt-1 text-[0.78rem] text-faint">
            {[selectedDevice.manufacturer, selectedDevice.model].filter(Boolean).join(" ") ||
              selectedDevice.id}
          </div>
        ) : null}
        <div className="relative mt-3 w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] pl-9 pr-10 text-sm text-foreground outline-none transition placeholder:text-faint focus:border-white/20 focus:bg-white/[0.07]"
          />
          {searchQuery ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-faint transition hover:bg-white/[0.08] hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {trimmedSearchQuery ? (
          <div className="mt-2 text-xs text-faint">
            {visibleCount} of {totalCount} matches
          </div>
        ) : null}
      </div>
      {selectedDevice ? (
        <div className="grid gap-5">
          <HomeAssistantControllableEntitiesSection
            instanceId={instanceId}
            entities={controllableDeviceEntities}
            onEntityChanged={patchEntityState}
            onOpenDetails={setDetailsEntity}
          />
          <HomeAssistantReadOnlyEntitiesSection
            instanceId={instanceId}
            entities={readOnlyDeviceEntities}
            onEntityChanged={patchEntityState}
            onOpenDetails={setDetailsEntity}
          />

          {filteredDeviceEntities.length === 0 ? (
            <div className="text-sm text-faint">
              {trimmedSearchQuery
                ? "No entities match your search."
                : "No entities found for this device."}
            </div>
          ) : null}
        </div>
      ) : null}
      {selectedArea && !selectedDevice ? (
        <div className="grid min-w-0 gap-2 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
          {filteredAreaDevices.map((device) => (
            <button
              type="button"
              key={device.id}
              onClick={() => openDevice(device)}
              className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-left transition hover:border-white/[0.11] hover:bg-white/[0.04]"
            >
              <div className="truncate text-[0.86rem] text-foreground">{device.name}</div>
              <div className="mt-1 text-[0.72rem] text-faint">
                {[device.manufacturer, device.model].filter(Boolean).join(" ") || device.id}
              </div>
            </button>
          ))}
          {filteredAreaDevices.length === 0 ? (
            <div className="text-sm text-faint">
              {trimmedSearchQuery
                ? "No devices match your search."
                : "No devices found for this area."}
            </div>
          ) : null}
        </div>
      ) : null}
      {mode === "areas" && !selectedArea ? (
        <div className="grid min-w-0 gap-2 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
          {filteredAreas.map((area) => (
            <button
              type="button"
              key={area.id}
              onClick={() => {
                pushNavigation({
                  type: "homeAssistant",
                  instanceId,
                  browseMode: "areas",
                  areaId: null,
                  deviceId: null,
                });
                pushNavigation({
                  type: "homeAssistant",
                  instanceId,
                  browseMode: "areas",
                  areaId: area.id,
                  deviceId: null,
                });
                setSelectedAreaId(area.id);
                setSearchQuery("");
              }}
              className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-left transition hover:border-white/[0.11] hover:bg-white/[0.04]"
            >
              <div className="text-[0.86rem] text-foreground">{area.name}</div>
              <div className="mt-1 text-[0.72rem] text-faint">{area.id}</div>
            </button>
          ))}
          {filteredAreas.length === 0 ? (
            <div className="text-sm text-faint">No areas match your search.</div>
          ) : null}
        </div>
      ) : null}
      {mode === "devices" && !selectedDevice ? (
        <div className="grid min-w-0 gap-2 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
          {filteredDevices.map((device) => (
            <button
              type="button"
              key={device.id}
              onClick={() => openDevice(device)}
              className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-left transition hover:border-white/[0.11] hover:bg-white/[0.04]"
            >
              <div className="truncate text-[0.86rem] text-foreground">{device.name}</div>
              <div className="mt-1 text-[0.72rem] text-faint">
                {[device.manufacturer, device.model].filter(Boolean).join(" ") || device.id}
              </div>
            </button>
          ))}
          {filteredDevices.length === 0 ? (
            <div className="text-sm text-faint">No devices match your search.</div>
          ) : null}
        </div>
      ) : null}
      {mode === "entities" || mode === "scenes" ? (
        filteredEntities.length === 0 ? (
          <div className="text-sm text-faint">
            {mode === "scenes"
              ? trimmedSearchQuery
                ? "No scenes match your search."
                : "No scenes found for this instance."
              : trimmedSearchQuery
                ? "No entities match your search."
                : "No entities found for this instance."}
          </div>
        ) : (
          <div className="grid gap-5">
            <HomeAssistantControllableEntitiesSection
              instanceId={instanceId}
              entities={controllableFilteredEntities}
              onEntityChanged={patchEntityState}
              onOpenDetails={setDetailsEntity}
            />
            <HomeAssistantReadOnlyEntitiesSection
              instanceId={instanceId}
              entities={readOnlyFilteredEntities}
              onEntityChanged={patchEntityState}
              onOpenDetails={setDetailsEntity}
            />
          </div>
        )
      ) : null}
      <HomeAssistantEntityDetailsDialog
        open={detailsEntity !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setDetailsEntity(null);
          }
        }}
        instanceId={instanceId}
        entity={detailsEntity}
      />
    </div>
  );
}
