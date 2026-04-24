import { useEffect, useRef } from "react";
import { getForgeCounts } from "../lib/api";
import { useForgeStore } from "../stores/forge-store";

const POLL_MS = 60_000;
const MIN_INTERVAL_MS = 30_000;

interface Options {
  instanceIds: string[];
  active: boolean;
}

export function useForgeCounts({ instanceIds, active }: Options) {
  const setCounts = useForgeStore((s) => s.setCounts);
  const lastFetchAt = useRef<Record<string, number>>({});
  const backoffUntil = useRef<Record<string, number>>({});

  const key = instanceIds.join(",");

  useEffect(() => {
    if (!active || instanceIds.length === 0) return;
    let cancelled = false;

    async function tick() {
      for (const id of instanceIds) {
        const now = Date.now();
        if (now - (lastFetchAt.current[id] ?? 0) < MIN_INTERVAL_MS) continue;
        if (now < (backoffUntil.current[id] ?? 0)) continue;
        lastFetchAt.current[id] = now;
        try {
          const counts = await getForgeCounts({ instanceId: id });
          if (cancelled) return;
          setCounts(id, counts);
        } catch (err: unknown) {
          const e = err as {
            status?: number;
            body?: { error?: string; resetAt?: string };
          };
          if (e?.body?.error === "FORGE_RATE_LIMITED" && e.body.resetAt) {
            backoffUntil.current[id] = new Date(e.body.resetAt).getTime();
          } else if (e?.status === 429) {
            backoffUntil.current[id] = Date.now() + 120_000;
          } else if (e?.status === 403) {
            // Token scope problem — back off longer; counts will stay stale until fixed.
            backoffUntil.current[id] = Date.now() + 10 * 60_000;
          }
        }
      }
    }

    void tick();
    const interval = setInterval(tick, POLL_MS);
    const onFocus = () => void tick();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, setCounts]);
}
