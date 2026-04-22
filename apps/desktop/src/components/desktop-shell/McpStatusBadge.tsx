import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useMcpStore } from "../../stores/mcp-store";

export function McpStatusBadge() {
  const status = useMcpStore((s) => s.status);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unhealthy = status.filter((s) => s.status.kind !== "ok" && s.status.kind !== "disabled");

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  if (unhealthy.length === 0) return null;

  return (
    <div ref={ref} className="relative [-webkit-app-region:no-drag]">
      <button
        type="button"
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.78rem] text-amber-400 hover:bg-amber-500/10"
        onClick={() => setOpen((v) => !v)}
        title={`${unhealthy.length} MCP server(s) need attention`}
      >
        <AlertTriangle size={13} />
        <span className="hidden lg:inline">MCP</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-80 rounded-md border border-white/[0.08] bg-[#1c1c1e] p-2 shadow-lg">
          <div className="mb-1 px-1 text-xs font-semibold text-faint">
            MCP servers needing attention
          </div>
          <ul className="flex flex-col">
            {unhealthy.map((s) => {
              const label =
                s.status.kind === "auth_failed"
                  ? "Auth failed"
                  : s.status.kind === "unreachable"
                    ? "Unreachable"
                    : s.status.kind === "misconfigured"
                      ? "Misconfigured"
                      : "Issue";
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 px-1 py-1 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.name}</div>
                    <div className="truncate text-xs text-muted">{label}</div>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-blue-300 underline"
                    onClick={() => {
                      const fn = (window as { slateOpenSettingsToMcp?: (id: string) => void })
                        .slateOpenSettingsToMcp;
                      fn?.(s.id);
                      setOpen(false);
                    }}
                  >
                    Fix
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
