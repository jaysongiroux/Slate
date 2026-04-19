import { useEffect, useMemo, useState } from "react";
import type { HomeAssistantEntitySummary, HomeAssistantHistoryEntry } from "@slate/shared";
import { Loader2 } from "lucide-react";
import { getHomeAssistantEntityHistory } from "../../lib/api";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { formatHomeAssistantUiError } from "./home-assistant-errors";
import { formatHomeAssistantCardValue } from "./HomeAssistantEntityCard";
import { HomeAssistantHistoryChart } from "./HomeAssistantHistoryChart";

const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const HISTORY_TABLE_PAGE = 20;
const ATTR_VALUE_MAX = 800;

/** Parse HA state into a number for charting, or null if not plottable. */
function parseStateForChart(state: string): number | null {
  const trimmed = state.trim();
  const normalized = trimmed.replace(/\s/g, "").replace(",", ".");
  const num = Number.parseFloat(normalized);
  if (Number.isFinite(num)) {
    return num;
  }
  const s = trimmed.toLowerCase();
  if (s === "on" || s === "active" || s === "open" || s === "true") {
    return 1;
  }
  if (s === "off" || s === "inactive" || s === "closed" || s === "false") {
    return 0;
  }
  return null;
}

function buildHistoryChartPoints(entries: HomeAssistantHistoryEntry[]): { t: number; v: number }[] {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.lastChanged).getTime() - new Date(b.lastChanged).getTime(),
  );
  const out: { t: number; v: number }[] = [];
  for (const row of sorted) {
    const v = parseStateForChart(row.state);
    if (v === null) {
      continue;
    }
    const t = new Date(row.lastChanged).getTime();
    if (Number.isNaN(t)) {
      continue;
    }
    out.push({ t, v });
  }
  return out;
}

function formatHistoryTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return iso;
  }
}

function formatAttributeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const s = JSON.stringify(value, null, 2);
    return s.length > ATTR_VALUE_MAX ? `${s.slice(0, ATTR_VALUE_MAX)}…` : s;
  } catch {
    return String(value);
  }
}

interface HomeAssistantEntityDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: string;
  entity: HomeAssistantEntitySummary | null;
}

export function HomeAssistantEntityDetailsDialog({
  open,
  onOpenChange,
  instanceId,
  entity,
}: HomeAssistantEntityDetailsDialogProps) {
  const [tab, setTab] = useState<"overview" | "history">("overview");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyEntries, setHistoryEntries] = useState<HomeAssistantHistoryEntry[]>([]);
  const [historyTableVisibleRows, setHistoryTableVisibleRows] = useState(HISTORY_TABLE_PAGE);

  useEffect(() => {
    if (!open) {
      setTab("overview");
    }
  }, [open]);

  useEffect(() => {
    setHistoryTableVisibleRows(HISTORY_TABLE_PAGE);
  }, [historyEntries, entity?.entityId]);

  useEffect(() => {
    if (!open || !entity || tab !== "history") {
      return;
    }

    let cancelled = false;
    const end = new Date();
    const start = new Date(end.getTime() - HISTORY_WINDOW_MS);

    void (async () => {
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const result = await getHomeAssistantEntityHistory({
          instanceId,
          entityId: entity.entityId,
          start: start.toISOString(),
          end: end.toISOString(),
        });
        if (!cancelled) {
          setHistoryEntries(result.entries);
        }
      } catch (err) {
        if (!cancelled) {
          setHistoryEntries([]);
          setHistoryError(formatHomeAssistantUiError(err, "Could not load history."));
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, entity?.entityId, instanceId, tab]);

  const historyChartPoints = useMemo(
    () => buildHistoryChartPoints(historyEntries),
    [historyEntries],
  );

  const historyTableRowsSorted = useMemo(
    () =>
      [...historyEntries].sort(
        (a, b) => new Date(b.lastChanged).getTime() - new Date(a.lastChanged).getTime(),
      ),
    [historyEntries],
  );

  const historyTableRowsShown = useMemo(
    () => historyTableRowsSorted.slice(0, historyTableVisibleRows),
    [historyTableRowsSorted, historyTableVisibleRows],
  );

  const historyTableHasMore = historyTableRowsSorted.length > historyTableVisibleRows;

  const sortedAttributes = useMemo(() => {
    const attrs = entity?.state?.attributes ?? {};
    return Object.keys(attrs)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => ({ key, value: attrs[key] }));
  }, [entity]);

  const title = entity?.name ?? "Entity";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))] max-h-[min(85vh,720px)]">
        <DialogHeader className="mb-3">
          <DialogTitle className="pr-8 text-left">{title}</DialogTitle>
          <DialogDescription className="text-left font-mono text-[0.72rem] text-faint break-all">
            {entity?.entityId ?? ""}
          </DialogDescription>
        </DialogHeader>

        {entity ? (
          <div className="grid gap-3">
            <div className="flex gap-1 rounded-md border border-white/[0.07] bg-white/[0.02] p-0.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 flex-1 rounded-sm text-[0.78rem]",
                  tab === "overview"
                    ? "bg-white/[0.06] text-foreground"
                    : "text-muted hover:text-foreground",
                )}
                onClick={() => setTab("overview")}
              >
                Overview
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 flex-1 rounded-sm text-[0.78rem]",
                  tab === "history"
                    ? "bg-white/[0.06] text-foreground"
                    : "text-muted hover:text-foreground",
                )}
                onClick={() => setTab("history")}
              >
                History
              </Button>
            </div>

            {tab === "overview" ? (
              <div className="grid gap-3">
                <dl className="m-0 grid gap-2 text-[0.82rem]">
                  <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
                    <dt className="text-faint">Domain</dt>
                    <dd className="m-0 font-medium text-foreground">{entity.domain}</dd>
                    <dt className="text-faint">State</dt>
                    <dd className="m-0 font-medium capitalize text-foreground">
                      {formatHomeAssistantCardValue(entity.state?.state)}
                    </dd>
                    {entity.deviceId ? (
                      <>
                        <dt className="text-faint">Device</dt>
                        <dd className="m-0 break-all font-mono text-[0.76rem] text-muted">
                          {entity.deviceId}
                        </dd>
                      </>
                    ) : null}
                    {entity.areaId ? (
                      <>
                        <dt className="text-faint">Area</dt>
                        <dd className="m-0 break-all font-mono text-[0.76rem] text-muted">
                          {entity.areaId}
                        </dd>
                      </>
                    ) : null}
                    {entity.state?.lastChanged ? (
                      <>
                        <dt className="text-faint">Last changed</dt>
                        <dd className="m-0 text-muted">
                          {formatHistoryTimestamp(entity.state.lastChanged)}
                        </dd>
                      </>
                    ) : null}
                    {entity.state?.lastUpdated ? (
                      <>
                        <dt className="text-faint">Last updated</dt>
                        <dd className="m-0 text-muted">
                          {formatHistoryTimestamp(entity.state.lastUpdated)}
                        </dd>
                      </>
                    ) : null}
                  </div>
                </dl>

                <div>
                  <h4 className="m-0 mb-2 text-[0.72rem] font-medium uppercase tracking-[0.06em] text-faint">
                    Attributes
                  </h4>
                  {sortedAttributes.length === 0 ? (
                    <p className="m-0 text-[0.8rem] text-muted">No attributes.</p>
                  ) : (
                    <ul className="m-0 grid list-none gap-2 p-0">
                      {sortedAttributes.map(({ key, value }) => (
                        <li
                          key={key}
                          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2"
                        >
                          <div className="font-mono text-[0.7rem] text-faint">{key}</div>
                          <pre className="m-0 mt-1 whitespace-pre-wrap break-all font-mono text-[0.72rem] text-foreground">
                            {formatAttributeValue(value)}
                          </pre>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid min-h-[12rem] gap-2">
                {historyLoading ? (
                  <div
                    className="flex flex-col items-center justify-center gap-2 py-12 text-faint"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                    <span className="text-sm">Loading history…</span>
                  </div>
                ) : historyError ? (
                  <p className="m-0 text-sm text-red-300">{historyError}</p>
                ) : historyEntries.length === 0 ? (
                  <p className="m-0 text-sm text-muted">No history in the last 24 hours.</p>
                ) : (
                  <div className="grid gap-3">
                    {historyChartPoints.length > 0 ? (
                      <HomeAssistantHistoryChart points={historyChartPoints} />
                    ) : (
                      <>
                        <p className="m-0 text-[0.72rem] text-muted">
                          No numeric or simple on/off samples to plot — raw history below.
                        </p>
                        <div className="rounded-md border border-white/[0.06]">
                          <table className="w-full border-collapse text-left text-[0.78rem]">
                            <thead className="sticky top-0 z-[1] border-b border-white/[0.08] bg-white/[0.06]">
                              <tr>
                                <th className="px-2.5 py-2 font-medium text-faint">Time</th>
                                <th className="px-2.5 py-2 font-medium text-faint">State</th>
                              </tr>
                            </thead>
                            <tbody>
                              {historyTableRowsShown.map((row, index) => (
                                <tr
                                  key={`${row.lastChanged}-${row.state}-${index}`}
                                  className="border-b border-white/[0.04] last:border-0"
                                >
                                  <td className="whitespace-nowrap px-2.5 py-1.5 align-top text-muted">
                                    {formatHistoryTimestamp(row.lastChanged)}
                                  </td>
                                  <td className="px-2.5 py-1.5 align-top capitalize text-foreground">
                                    {formatHomeAssistantCardValue(row.state)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <p className="m-0 text-[0.7rem] text-faint">
                            Showing {historyTableRowsShown.length} of{" "}
                            {historyTableRowsSorted.length} rows
                          </p>
                          {historyTableHasMore ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 shrink-0 self-start text-[0.78rem] sm:self-auto"
                              onClick={() =>
                                setHistoryTableVisibleRows((n) => n + HISTORY_TABLE_PAGE)
                              }
                            >
                              Show 20 more
                            </Button>
                          ) : null}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
