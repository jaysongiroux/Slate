import React, { useEffect, useState, useCallback } from "react";
import { Box, H2, H5, Text } from "@adminjs/design-system";
import { ApiClient } from "adminjs";

type QueueInfo = {
  name: string;
  created: number;
  retry: number;
  active: number;
  completed: number;
  failed: number;
  cancelled: number;
};

type FailedJob = {
  id: string;
  name: string;
  createdOn: string | null;
  completedOn: string | null;
  output: unknown;
};

type ScheduleInfo = {
  name: string;
  cron: string;
  updatedOn: string | null;
};

type PgBossStats = {
  queues: QueueInfo[];
  recentFailed: FailedJob[];
  schedules: ScheduleInfo[];
  ran?: { name: string } | null;
  runError?: string | null;
};

type Notice = { kind: "success" | "error"; message: string };

const POLL_INTERVAL_MS = 10_000;
const STATES = ["created", "retry", "active", "completed", "failed", "cancelled"] as const;

function formatTime(date: Date) {
  return date.toLocaleTimeString();
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: "2px solid #e0e0e0",
  color: "#666",
  fontWeight: 600,
  fontSize: "12px",
  textTransform: "uppercase",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid #f0f0f0",
};

function cellColor(state: string, count: number): React.CSSProperties | undefined {
  if (count === 0) return undefined;
  if (state === "failed") return { color: "#c62828", fontWeight: 600 };
  if (state === "active") return { color: "#2e7d32", fontWeight: 600 };
  if (state === "retry") return { color: "#e65100", fontWeight: 600 };
  return undefined;
}

const PgBossDashboard: React.FC = () => {
  const [data, setData] = useState<PgBossStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [runningSchedule, setRunningSchedule] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const fetchData = useCallback(async (runSchedule?: string) => {
    try {
      const api = new ApiClient();
      const res = await api.getPage({
        pageName: "pgboss",
        params: runSchedule ? { runSchedule } : undefined,
      });
      const payload = res.data as PgBossStats;
      setData(payload);
      setLastUpdated(new Date());
      setError(null);
      if (runSchedule) {
        if (payload.runError) {
          setNotice({ kind: "error", message: `Failed to run ${runSchedule}: ${payload.runError}` });
        } else if (payload.ran?.name) {
          setNotice({ kind: "success", message: `Enqueued job for ${payload.ran.name}` });
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load pgBoss stats");
    }
  }, []);

  const runSchedule = useCallback(
    async (name: string) => {
      setRunningSchedule(name);
      setNotice(null);
      try {
        await fetchData(name);
      } finally {
        setRunningSchedule(null);
      }
    },
    [fetchData],
  );

  useEffect(() => {
    void fetchData();
    const id = setInterval(() => void fetchData(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  if (error) {
    return (
      <Box p="xl">
        <Text color="error">{error}</Text>
      </Box>
    );
  }

  if (!data) {
    return (
      <Box p="xl">
        <Text color="grey60">Loading…</Text>
      </Box>
    );
  }

  return (
    <Box px="xl" py="lg">
      <Box display="flex" justifyContent="space-between" alignItems="center" mb="xl">
        <H2>pgBoss Job Queues</H2>
        {lastUpdated && (
          <Text color="grey60" fontSize="sm">
            Updated {formatTime(lastUpdated)} · polling every {POLL_INTERVAL_MS / 1000}s
          </Text>
        )}
      </Box>

      {/* Queue Overview */}
      <H5 mb="default" color="grey60">
        Queues
      </H5>
      {data.queues.length === 0 ? (
        <Text color="grey60" mb="xxl">
          No queues found.
        </Text>
      ) : (
        <Box variant="white" p="lg" boxShadow="card" mb="xxl" style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Queue</th>
                {STATES.map((s) => (
                  <th key={s} style={{ ...thStyle, textAlign: "right" }}>
                    {s}
                  </th>
                ))}
                <th style={{ ...thStyle, textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.queues.map((q) => {
                const total = q.created + q.retry + q.active + q.completed + q.failed + q.cancelled;
                return (
                  <tr key={q.name}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{q.name}</td>
                    {STATES.map((s) => {
                      const count = q[s];
                      return (
                        <td
                          key={s}
                          style={{ ...tdStyle, textAlign: "right", ...cellColor(s, count) }}
                        >
                          {count}
                        </td>
                      );
                    })}
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Box>
      )}

      {/* Schedules */}
      <H5 mb="default" color="grey60">
        Schedules
      </H5>
      {notice && (
        <Box
          mb="default"
          p="default"
          style={{
            borderRadius: "6px",
            background: notice.kind === "success" ? "#e8f5e9" : "#ffebee",
            color: notice.kind === "success" ? "#1b5e20" : "#b71c1c",
            fontSize: "13px",
          }}
        >
          {notice.message}
        </Box>
      )}
      {data.schedules.length === 0 ? (
        <Text color="grey60" mb="xxl">
          No schedules configured.
        </Text>
      ) : (
        <Box variant="white" p="lg" boxShadow="card" mb="xxl" style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Queue</th>
                <th style={thStyle}>Cron</th>
                <th style={thStyle}>Last Updated</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.schedules.map((s) => {
                const isRunning = runningSchedule === s.name;
                return (
                  <tr key={s.name}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{s.name}</td>
                    <td style={tdStyle}>
                      <code>{s.cron}</code>
                    </td>
                    <td style={tdStyle}>{formatDate(s.updatedOn)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={() => void runSchedule(s.name)}
                        disabled={isRunning || runningSchedule !== null}
                        style={{
                          padding: "4px 10px",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "#fff",
                          background: isRunning ? "#9ca3af" : "#366CED",
                          border: "none",
                          borderRadius: "4px",
                          cursor: isRunning || runningSchedule !== null ? "not-allowed" : "pointer",
                          opacity: runningSchedule !== null && !isRunning ? 0.5 : 1,
                        }}
                      >
                        {isRunning ? "Running…" : "Run now"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Box>
      )}

      {/* Recent Failures */}
      <H5 mb="default" color="grey60">
        Recent Failures
      </H5>
      {data.recentFailed.length === 0 ? (
        <Text color="grey60">No failed jobs.</Text>
      ) : (
        <Box variant="white" p="lg" boxShadow="card" style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Queue</th>
                <th style={thStyle}>Created</th>
                <th style={thStyle}>Failed</th>
                <th style={thStyle}>Error</th>
              </tr>
            </thead>
            <tbody>
              {data.recentFailed.map((j) => (
                <tr key={j.id}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{j.name}</td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatDate(j.createdOn)}</td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatDate(j.completedOn)}</td>
                  <td style={{ ...tdStyle, maxWidth: "400px" }}>
                    <code
                      style={{
                        fontSize: "12px",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}
                    >
                      {j.output
                        ? typeof j.output === "string"
                          ? j.output
                          : JSON.stringify(j.output, null, 2)
                        : "—"}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
    </Box>
  );
};

export default PgBossDashboard;
