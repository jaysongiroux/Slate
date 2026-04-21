import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** Tailwind violet-400 — chart stroke/fill accent */
const VIOLET_STROKE = "#a78bfa";
const VIOLET_SOFT = "#c4b5fd";

function formatYTick(n: number): string {
  if (!Number.isFinite(n)) {
    return "";
  }
  const a = Math.abs(n);
  if (a >= 1000) {
    return n.toFixed(0);
  }
  if (a >= 100) {
    return n.toFixed(1);
  }
  return n.toFixed(2);
}

function formatXTick(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface HomeAssistantHistoryChartProps {
  points: { t: number; v: number }[];
}

export function HomeAssistantHistoryChart({ points }: HomeAssistantHistoryChartProps) {
  const rawId = useId();
  const gradientId = `haHistPurple-${rawId.replace(/:/g, "")}`;

  const data = points.map((p) => ({ t: p.t, v: p.v }));
  const showDots = points.length <= 120;

  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-1 pb-2 pt-1">
      <div className="mb-2 px-1 text-[0.7rem] font-medium uppercase tracking-[0.06em] text-faint">
        State over time
      </div>
      <div className="h-[220px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 8, left: 4, bottom: 4 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={VIOLET_STROKE} stopOpacity={0.35} />
                <stop offset="100%" stopColor={VIOLET_STROKE} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={formatXTick}
              tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              dataKey="v"
              domain={["auto", "auto"]}
              tickFormatter={formatYTick}
              tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(12, 12, 16, 0.96)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10,
                fontSize: 12,
                color: "rgba(255,255,255,0.92)",
              }}
              labelStyle={{ color: "rgba(255,255,255,0.55)" }}
              labelFormatter={(t) =>
                typeof t === "number" ? new Date(t).toLocaleString() : String(t)
              }
              formatter={(value: number | string) => [value, "State"]}
            />
            <Area
              type="monotone"
              dataKey="v"
              stroke={VIOLET_STROKE}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
              dot={
                showDots
                  ? { r: 2.5, fill: VIOLET_SOFT, stroke: VIOLET_STROKE, strokeWidth: 1 }
                  : false
              }
              activeDot={{ r: 4, fill: VIOLET_SOFT, stroke: VIOLET_STROKE }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
