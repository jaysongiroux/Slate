import { useEffect, useMemo, useRef, useState } from "react";
import type { HomeAssistantEntitySummary } from "@slate/shared";
import { resolveHomeAssistantCameraSnapshotUrl } from "../../lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { formatHomeAssistantUiError } from "./home-assistant-errors";

/** Keep this reasonably fast without hammering HA/core-backend. */
const DEFAULT_POLL_MS = 900;

export function HomeAssistantCameraPreviewDialog({
  open,
  onOpenChange,
  instanceId,
  entity,
  pollMs = DEFAULT_POLL_MS,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: string;
  entity: HomeAssistantEntitySummary | null;
  pollMs?: number;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(() => Date.now());
  /** Shown in <img>; only updated after each URL preloads so the previous frame stays visible during refresh. */
  const [displaySrc, setDisplaySrc] = useState("");
  const latestUrlRef = useRef("");

  const entityId = entity?.entityId ?? "";
  const isCamera = entity?.domain === "camera";

  useEffect(() => {
    if (!open) {
      setError("");
      setBaseUrl("");
      setRevision(Date.now());
      setDisplaySrc("");
      return;
    }
    if (!entityId || !isCamera) {
      setError("Camera preview unavailable.");
      return;
    }

    let cancelled = false;
    setError("");
    void resolveHomeAssistantCameraSnapshotUrl({ instanceId, entityId })
      .then((url: string) => {
        if (!cancelled) {
          setBaseUrl(url);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(formatHomeAssistantUiError(err, "Camera preview unavailable."));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [entityId, instanceId, isCamera, open]);

  const snapshotUrl = useMemo(() => {
    if (!baseUrl) return "";
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}refresh=${revision}`;
  }, [baseUrl, revision]);

  useEffect(() => {
    if (!open || !snapshotUrl) return;
    latestUrlRef.current = snapshotUrl;

    let cancelled = false;
    const url = snapshotUrl;
    const probe = new Image();
    probe.onload = () => {
      if (!cancelled && url === latestUrlRef.current) {
        setDisplaySrc(url);
      }
    };
    probe.onerror = () => {
      if (!cancelled && url === latestUrlRef.current) {
        setError("Camera preview unavailable.");
      }
    };
    probe.src = url;

    return () => {
      cancelled = true;
    };
  }, [open, snapshotUrl]);

  useEffect(() => {
    if (!open || !isCamera) return;
    const effective = Math.max(250, pollMs);
    const id = window.setInterval(() => {
      setRevision(Date.now());
    }, effective);
    return () => window.clearInterval(id);
  }, [isCamera, open, pollMs]);

  const title = entity?.name ?? "Camera";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(980px,calc(100vw-24px))] max-h-[min(88vh,860px)] p-0 overflow-hidden">
        <div className="flex flex-col">
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="pr-10 text-left">{title}</DialogTitle>
            <DialogDescription className="text-left font-mono text-[0.72rem] text-faint break-all">
              {entityId}
            </DialogDescription>
          </DialogHeader>

          <div className="px-5 pb-5">
            <div className="aspect-video overflow-hidden rounded-lg border border-white/[0.055] bg-black/25">
              {displaySrc ? (
                <img
                  src={displaySrc}
                  alt={`${title} camera snapshot`}
                  className="h-full w-full object-contain bg-black"
                  draggable={false}
                />
              ) : (
                <div className="grid h-full min-h-[14rem] place-items-center px-4 text-center text-[0.8rem] text-faint">
                  {error ? error : "Loading camera preview…"}
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
