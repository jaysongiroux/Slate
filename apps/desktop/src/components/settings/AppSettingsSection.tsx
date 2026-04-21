import { useEffect, useRef, useState } from "react";
import { desktopApi, type AppLogEvent } from "../../lib/api";

type LogLine = {
  id: number;
  raw: string;
  ts?: string;
  level?: string;
  scope?: string;
  message?: string;
  details?: string;
};

const MAX_LOG_LINES = 600;

function formatLogDetails(parsed: Record<string, unknown>) {
  const details = { ...parsed };
  delete details.ts;
  delete details.level;
  delete details.scope;
  delete details.source;
  delete details.message;

  if (!Object.keys(details).length) return undefined;
  return JSON.stringify(details);
}

function parseLogLine(raw: string, id: number): LogLine {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const parsedRecord = parsed as Record<string, unknown>;
      return {
        id,
        raw,
        ts: typeof parsedRecord.ts === "string" ? parsedRecord.ts : undefined,
        level: typeof parsedRecord.level === "string" ? parsedRecord.level : undefined,
        scope:
          typeof parsedRecord.scope === "string"
            ? parsedRecord.scope
            : typeof parsedRecord.source === "string"
              ? parsedRecord.source
              : undefined,
        message: typeof parsedRecord.message === "string" ? parsedRecord.message : undefined,
        details: formatLogDetails(parsedRecord),
      };
    }
  } catch {
    // Raw console/text lines are still useful diagnostics.
  }
  return { id, raw };
}

function appendLogChunk(previous: LogLine[], chunk: string, nextId: () => number): LogLine[] {
  const parsed = chunk
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => parseLogLine(line, nextId()));
  if (!parsed.length) return previous;
  return [...previous, ...parsed].slice(-MAX_LOG_LINES);
}

function formatLogTime(ts?: string) {
  if (!ts) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function levelClass(level?: string) {
  if (level === "error") return "text-danger";
  if (level === "warn") return "text-[rgb(246,194,99)]";
  if (level === "debug") return "text-faint";
  return "text-[rgb(125,211,252)]";
}

export function AppSettingsSection() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [logPath, setLogPath] = useState("");
  const [error, setError] = useState("");
  const nextIdRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => Promise<unknown>) | null = null;

    const handleLogEvent = (event: AppLogEvent) => {
      if (disposed) return;
      setLogPath(event.path);
      if (event.type === "initial") {
        setLines([]);
        nextIdRef.current = 1;
      }
      setLines((current) =>
        appendLogChunk(current, event.chunk, () => {
          const id = nextIdRef.current;
          nextIdRef.current += 1;
          return id;
        }),
      );
    };

    setError("");
    const subscribeAppLog = desktopApi().subscribeAppLog;
    if (!subscribeAppLog) {
      setError("Log streaming is not available in this build.");
      return () => {
        disposed = true;
      };
    }

    subscribeAppLog(handleLogEvent)
      .then((subscription) => {
        if (disposed) {
          void subscription.unsubscribe();
          return;
        }
        unsubscribe = subscription.unsubscribe;
        setLogPath(subscription.path);
      })
      .catch((err) => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      disposed = true;
      void unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 rounded-[14px] border border-white/[0.06] bg-white/[0.04] p-3.5">
        <div>
          <div className="text-[0.96rem] font-semibold text-foreground">Logs</div>
          <div className="mt-1 font-mono text-[0.72rem] leading-snug text-faint break-all">
            {logPath || "Waiting for the desktop log path..."}
          </div>
        </div>

        {error ? (
          <p className="m-0 text-[0.78rem] leading-snug text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        className="h-[min(46vh,430px)] overflow-y-auto rounded-[12px] border border-white/[0.06] bg-black/25 p-2.5 font-mono text-[0.72rem] leading-relaxed [scrollbar-width:thin]"
        aria-label="Application logs"
      >
        {lines.length ? (
          <div className="grid gap-1">
            {lines.map((line) => (
              <div
                key={line.id}
                className="grid grid-cols-[72px_52px_92px_minmax(0,1fr)] gap-2 border-b border-white/[0.04] pb-1 last:border-b-0 max-[760px]:grid-cols-[64px_48px_minmax(0,1fr)]"
              >
                <span className="text-faint">{formatLogTime(line.ts)}</span>
                <span className={levelClass(line.level)}>{line.level ?? "log"}</span>
                <span className="truncate text-muted max-[760px]:hidden">{line.scope ?? "-"}</span>
                <span className="min-w-0 break-words text-foreground/85">
                  <span>{line.message ?? line.raw}</span>
                  {line.details ? (
                    <span className="mt-0.5 block text-faint">{line.details}</span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-center text-faint">
            Waiting for log entries.
          </div>
        )}
      </div>
    </div>
  );
}
