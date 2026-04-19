import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  HomeAssistantDashboardEntitySummary,
  HomeAssistantLiveStatus,
  HomeAssistantState,
} from "@slate/shared";
import { getHomeAssistantDashboard, subscribeHomeAssistantEvents } from "../../lib/api";
import {
  HomeAssistantControllableEntitiesSection,
  HomeAssistantReadOnlyEntitiesSection,
} from "./home-assistant-entity-sections";
import { formatHomeAssistantUiError } from "./home-assistant-errors";

interface HomeAssistantDashboardViewProps {
  instanceId: string;
  dashboardId: string;
  refreshSignal?: number;
}

export function HomeAssistantDashboardView({
  instanceId,
  dashboardId,
  refreshSignal = 0,
}: HomeAssistantDashboardViewProps) {
  const [summary, setSummary] = useState<HomeAssistantDashboardEntitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveStatus, setLiveStatus] = useState<HomeAssistantLiveStatus>("connecting");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSummary(await getHomeAssistantDashboard({ instanceId, dashboardId }));
    } catch (err) {
      setSummary(null);
      setError(formatHomeAssistantUiError(err, "Could not load dashboard."));
    } finally {
      setLoading(false);
    }
  }, [dashboardId, instanceId]);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  const patchEntityState = useCallback((state?: HomeAssistantState | null) => {
    if (!state) {
      return;
    }

    setSummary((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        entities: current.entities.map((entity) =>
          entity.entityId === state.entityId ? { ...entity, state } : entity,
        ),
      };
    });
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

  const dashboardEntities = summary?.entities ?? [];
  const controllableDashboardEntities = useMemo(
    () => dashboardEntities.filter((entity) => entity.supportedControls.length > 0),
    [dashboardEntities],
  );
  const readOnlyDashboardEntities = useMemo(
    () => dashboardEntities.filter((entity) => entity.supportedControls.length === 0),
    [dashboardEntities],
  );

  if (loading) {
    return <div className="p-8 text-sm text-faint">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="p-8 text-sm text-red-300">{error}</div>;
  }

  if (!summary) {
    return <div className="p-8 text-sm text-faint">No dashboard selected.</div>;
  }

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

  const isNotSuccessful = liveStatus !== "connected" && liveStatus !== "connecting";

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden overflow-y-auto overflow-x-hidden px-4 py-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <div className="mb-5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="m-0 min-w-0 truncate text-xl font-semibold text-foreground">
            {summary.dashboard.title}
          </h2>
          {isNotSuccessful ? (
            <span
              className={`shrink-0 rounded-md border px-2 py-0.5 text-[0.72rem] ${liveClassName}`}
            >
              {liveLabel}
            </span>
          ) : null}
        </div>
      </div>
      {summary.stale ? (
        <div className="mb-4 rounded-md border border-amber-300/15 bg-amber-300/10 px-3 py-2 text-[0.82rem] text-amber-100">
          Live updates are unavailable. Showing the latest refreshable state.
        </div>
      ) : null}
      <div className="grid gap-5">
        <HomeAssistantControllableEntitiesSection
          instanceId={instanceId}
          entities={controllableDashboardEntities}
          onEntityChanged={patchEntityState}
        />
        <HomeAssistantReadOnlyEntitiesSection
          instanceId={instanceId}
          entities={readOnlyDashboardEntities}
          onEntityChanged={patchEntityState}
        />
      </div>
    </div>
  );
}
