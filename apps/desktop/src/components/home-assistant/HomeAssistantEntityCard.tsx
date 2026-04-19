import { useEffect, useMemo, useState } from "react";
import type {
  HomeAssistantControlKind,
  HomeAssistantEntitySummary,
  HomeAssistantState,
} from "@slate/shared";
import { controlHomeAssistantEntity, resolveHomeAssistantCameraSnapshotUrl } from "../../lib/api";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { formatHomeAssistantUiError } from "./home-assistant-errors";

interface HomeAssistantEntityCardProps {
  instanceId: string;
  entity: HomeAssistantEntitySummary;
  onChanged?: (state?: HomeAssistantState | null) => void;
}

const isoDateLikePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export function formatHomeAssistantCardValue(value: unknown) {
  if (typeof value !== "string") return value == null ? "unknown" : String(value);
  if (!isoDateLikePattern.test(value)) return value.replaceAll("_", " ");

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function displayState(entity: HomeAssistantEntitySummary) {
  return formatHomeAssistantCardValue(entity.state?.state);
}

function isUnknownOrUnavailableState(state: unknown): boolean {
  if (state == null || state === "") return true;
  const s = String(state).toLowerCase();
  return s === "unknown" || s === "unavailable";
}

const controlButtonClass =
  "h-7 rounded-md px-2 text-[0.8rem] font-medium text-muted hover:bg-white/[0.05] hover:text-foreground";

const binaryPowerButtonActiveClass =
  "h-7 rounded-md px-2 text-[0.8rem] font-medium border border-emerald-300/25 bg-emerald-300/10 text-emerald-200 hover:bg-emerald-300/15 hover:text-emerald-100";

export function HomeAssistantEntityCard({
  instanceId,
  entity,
  onChanged,
}: HomeAssistantEntityCardProps) {
  const [pendingControl, setPendingControl] = useState<HomeAssistantControlKind | null>(null);
  const [brightness, setBrightness] = useState(70);
  const [color, setColor] = useState("#ffffff");
  const [temperature, setTemperature] = useState(21);
  const [error, setError] = useState("");
  const [cameraSnapshotUrl, setCameraSnapshotUrl] = useState("");
  const [cameraSnapshotError, setCameraSnapshotError] = useState("");
  const [cameraSnapshotRevision, setCameraSnapshotRevision] = useState(() => Date.now());

  const controls = new Set(entity.supportedControls);
  const canControl = entity.supportedControls.length > 0;
  const isCamera = entity.domain === "camera";

  const stateRaw = entity.state?.state;
  const stateLower = typeof stateRaw === "string" ? stateRaw.toLowerCase() : "";
  const hasBinaryPowerControls =
    controls.has("turn_on") || controls.has("turn_off") || controls.has("toggle");
  const unknownOrUnavailable = isUnknownOrUnavailableState(stateRaw);
  const showStateBadge = !hasBinaryPowerControls || unknownOrUnavailable;
  const toggleOnly =
    controls.has("toggle") && !controls.has("turn_on") && !controls.has("turn_off");

  function powerControlButtonClass(opts: { active: boolean; toggleButton: boolean }) {
    if (!hasBinaryPowerControls || unknownOrUnavailable) {
      return controlButtonClass;
    }
    if (opts.toggleButton) {
      if (toggleOnly) {
        return opts.active ? binaryPowerButtonActiveClass : controlButtonClass;
      }
      return controlButtonClass;
    }
    return opts.active ? binaryPowerButtonActiveClass : controlButtonClass;
  }
  const cameraImageUrl = useMemo(() => {
    if (!cameraSnapshotUrl) return "";
    const separator = cameraSnapshotUrl.includes("?") ? "&" : "?";
    return `${cameraSnapshotUrl}${separator}refresh=${cameraSnapshotRevision}`;
  }, [cameraSnapshotRevision, cameraSnapshotUrl]);

  useEffect(() => {
    if (!isCamera) {
      setCameraSnapshotUrl("");
      setCameraSnapshotError("");
      return;
    }

    let cancelled = false;
    setCameraSnapshotError("");
    void resolveHomeAssistantCameraSnapshotUrl({ instanceId, entityId: entity.entityId })
      .then((url) => {
        if (!cancelled) {
          setCameraSnapshotUrl(url);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCameraSnapshotError(formatHomeAssistantUiError(err, "Camera preview unavailable."));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [entity.entityId, instanceId, isCamera]);

  async function runControl(control: HomeAssistantControlKind, value?: unknown) {
    setPendingControl(control);
    setError("");
    try {
      const result = await controlHomeAssistantEntity({
        instanceId,
        request: { entityId: entity.entityId, control, value },
      });
      onChanged?.(result.state ?? null);
    } catch (err) {
      setError(formatHomeAssistantUiError(err));
    } finally {
      setPendingControl(null);
    }
  }

  function rgbFromHex(hex: string) {
    const normalized = hex.replace("#", "");
    return [
      Number.parseInt(normalized.slice(0, 2), 16),
      Number.parseInt(normalized.slice(2, 4), 16),
      Number.parseInt(normalized.slice(4, 6), 16),
    ];
  }

  return (
    <article className="min-w-0 rounded-lg border border-white/[0.055] bg-white/[0.018] p-2.5">
      <div className="grid gap-2">
        <div className="min-w-0 pr-1">
          <h3 className="m-0 truncate text-[0.86rem] font-medium text-foreground">{entity.name}</h3>
          <p className="m-0 mt-0.5 truncate text-[0.72rem] text-faint">{entity.entityId}</p>
        </div>
        {showStateBadge ? (
          <span
            className={cn(
              "w-fit max-w-full truncate rounded-md border px-1.5 py-0.5 text-[0.7rem] capitalize",
              hasBinaryPowerControls && unknownOrUnavailable
                ? "border-amber-300/20 text-amber-100"
                : entity.state?.state === "on"
                  ? "border-emerald-300/15 text-emerald-200"
                  : "border-white/[0.07] text-muted",
            )}
          >
            {displayState(entity)}
          </span>
        ) : null}
      </div>

      {canControl && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          {controls.has("turn_on") ? (
            <Button
              size="sm"
              variant="ghost"
              className={powerControlButtonClass({
                active: stateLower === "on",
                toggleButton: false,
              })}
              disabled={pendingControl !== null}
              onClick={() => void runControl("turn_on")}
            >
              On
            </Button>
          ) : null}
          {controls.has("turn_off") ? (
            <Button
              size="sm"
              variant="ghost"
              className={powerControlButtonClass({
                active: stateLower === "off",
                toggleButton: false,
              })}
              disabled={pendingControl !== null}
              onClick={() => void runControl("turn_off")}
            >
              Off
            </Button>
          ) : null}
          {controls.has("toggle") ? (
            <Button
              size="sm"
              variant="ghost"
              className={powerControlButtonClass({
                active: stateLower === "on",
                toggleButton: true,
              })}
              disabled={pendingControl !== null}
              onClick={() => void runControl("toggle")}
            >
              Toggle
            </Button>
          ) : null}
          {controls.has("scene_run") ? (
            <Button
              size="sm"
              variant="ghost"
              className={controlButtonClass}
              disabled={pendingControl !== null}
              onClick={() => void runControl("scene_run")}
            >
              Run
            </Button>
          ) : null}
          {controls.has("script_run") ? (
            <Button
              size="sm"
              variant="ghost"
              className={controlButtonClass}
              disabled={pendingControl !== null}
              onClick={() => void runControl("script_run")}
            >
              Run
            </Button>
          ) : null}
        </div>
      )}

      {isCamera ? (
        <div className="mt-2.5 grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.7rem] text-faint">Camera snapshot</span>
            <Button
              size="sm"
              variant="ghost"
              className={controlButtonClass}
              onClick={() => {
                setCameraSnapshotError("");
                setCameraSnapshotRevision(Date.now());
              }}
            >
              Refresh
            </Button>
          </div>
          <div className="aspect-video overflow-hidden rounded-md border border-white/[0.055] bg-black/20">
            {cameraImageUrl ? (
              <img
                key={cameraImageUrl}
                src={cameraImageUrl}
                alt={`${entity.name} camera snapshot`}
                className="h-full w-full object-cover"
                onError={() => setCameraSnapshotError("Camera preview unavailable.")}
              />
            ) : (
              <div className="grid h-full place-items-center px-3 text-center text-[0.72rem] text-faint">
                Loading camera snapshot...
              </div>
            )}
          </div>
          {cameraSnapshotError ? (
            <p className="m-0 text-[0.72rem] leading-snug text-red-300">{cameraSnapshotError}</p>
          ) : null}
        </div>
      ) : null}

      {controls.has("light_brightness") ? (
        <div className="mt-2.5 grid gap-1.5">
          <label className="text-[0.7rem] text-faint">Brightness</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              value={brightness}
              onChange={(event) => setBrightness(Number(event.target.value))}
              className="h-1.5 min-w-0 flex-1 accent-muted"
            />
            <Button
              size="sm"
              variant="ghost"
              className={controlButtonClass}
              disabled={pendingControl !== null}
              onClick={() => void runControl("light_brightness", brightness)}
            >
              Set
            </Button>
          </div>
        </div>
      ) : null}

      {controls.has("light_color") ? (
        <div className="mt-2.5 flex items-end gap-2">
          <div className="grid gap-1.5">
            <label className="text-[0.7rem] text-faint">Color</label>
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="h-7 w-10 rounded-md border border-white/[0.08] bg-transparent"
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            className={controlButtonClass}
            disabled={pendingControl !== null}
            onClick={() => void runControl("light_color", rgbFromHex(color))}
          >
            Set
          </Button>
        </div>
      ) : null}

      {controls.has("climate_temperature") ? (
        <div className="mt-2.5 flex items-end gap-2">
          <div className="grid gap-1.5">
            <label className="text-[0.7rem] text-faint">Temperature</label>
            <input
              type="number"
              value={temperature}
              step={0.5}
              onChange={(event) => setTemperature(Number(event.target.value))}
              className="h-7 w-20 rounded-md border border-white/[0.08] bg-white/[0.025] px-2 text-[0.8rem] text-foreground outline-none"
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            className={controlButtonClass}
            disabled={pendingControl !== null}
            onClick={() => void runControl("climate_temperature", temperature)}
          >
            Set
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="m-0 mt-2.5 text-[0.76rem] leading-snug text-red-300">{error}</p>
      ) : null}
    </article>
  );
}
