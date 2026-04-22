import { useEffect, useMemo, useState } from "react";
import { useMcpStore } from "../../stores/mcp-store";
import {
  mcpApi,
  type McpServerPublic,
  type McpServerSaveInput,
  type McpToolDescriptor,
} from "../../lib/api/mcp-api";
import { McpServerDialog } from "./McpServerDialog";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";

export function McpServersPanel({ focusedServerId }: { focusedServerId?: string }) {
  const { servers, status, loadServers, saveServers, refreshStatus } = useMcpStore();
  const [editing, setEditing] = useState<McpServerPublic | null>(null);
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(focusedServerId ?? null);
  const [toolsByServer, setToolsByServer] = useState<Record<string, McpToolDescriptor[]>>({});
  const [toolsLoading, setToolsLoading] = useState<string | null>(null);

  useEffect(() => {
    void loadServers();
    void refreshStatus();
  }, []);

  useEffect(() => {
    if (focusedServerId) setExpandedId(focusedServerId);
  }, [focusedServerId]);

  useEffect(() => {
    if (!focusedServerId) return;
    if (toolsByServer[focusedServerId]) return; // already fetched
    const target = servers.find((s) => s.id === focusedServerId);
    if (!target) return;
    let cancelled = false;
    setToolsLoading(focusedServerId);
    mcpApi
      .listServerTools(focusedServerId)
      .then(
        (tools) => {
          if (!cancelled) setToolsByServer((prev) => ({ ...prev, [focusedServerId]: tools }));
        },
        () => {
          if (!cancelled) setToolsByServer((prev) => ({ ...prev, [focusedServerId]: [] }));
        },
      )
      .finally(() => {
        if (!cancelled) setToolsLoading(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedServerId, servers]);

  const statusById = useMemo(
    () => Object.fromEntries(status.map((s) => [s.id, s.status])),
    [status],
  );

  const handleSaveOne = async (input: McpServerSaveInput) => {
    const others: McpServerSaveInput[] = servers
      .filter((s) => s.id !== input.id)
      .map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        transport: s.transport,
        auth: { type: "unchanged" },
        enabled: s.enabled,
        enabledTools: s.enabledTools,
        description: s.description,
      }));
    await saveServers([...others, input]);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this MCP server?")) return;
    const remaining: McpServerSaveInput[] = servers
      .filter((s) => s.id !== id)
      .map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        transport: s.transport,
        auth: { type: "unchanged" },
        enabled: s.enabled,
        enabledTools: s.enabledTools,
        description: s.description,
      }));
    await saveServers(remaining);
  };

  const handleToggleEnabled = async (server: McpServerPublic) => {
    await handleSaveOne({
      id: server.id,
      name: server.name,
      url: server.url,
      transport: server.transport,
      auth: { type: "unchanged" },
      enabled: !server.enabled,
      enabledTools: server.enabledTools,
      description: server.description,
    });
  };

  const expand = async (server: McpServerPublic) => {
    setExpandedId(expandedId === server.id ? null : server.id);
    if (!toolsByServer[server.id]) {
      setToolsLoading(server.id);
      try {
        const tools = await mcpApi.listServerTools(server.id);
        setToolsByServer((prev) => ({ ...prev, [server.id]: tools }));
      } catch {
        setToolsByServer((prev) => ({ ...prev, [server.id]: [] }));
      } finally {
        setToolsLoading(null);
      }
    }
  };

  const handleToolToggle = async (server: McpServerPublic, toolName: string, on: boolean) => {
    const allToolNames = (toolsByServer[server.id] ?? []).map((t) => t.name);
    const current = server.enabledTools ?? allToolNames;
    const next = on
      ? Array.from(new Set([...current, toolName]))
      : current.filter((n) => n !== toolName);
    await handleSaveOne({
      id: server.id,
      name: server.name,
      url: server.url,
      transport: server.transport,
      auth: { type: "unchanged" },
      enabled: server.enabled,
      enabledTools: next,
      description: server.description,
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-2 text-[0.82rem] font-semibold uppercase tracking-[0.04em] text-faint">
        MCP Servers
      </div>

      {servers.length === 0 ? (
        <p className="text-xs text-muted">
          No MCP servers configured. Add one to extend AI Chat with external tools.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {servers.map((s) => {
            const st = statusById[s.id];
            const dot = !s.enabled
              ? "bg-gray-400"
              : st?.kind === "ok"
                ? "bg-green-500"
                : st
                  ? "bg-amber-500"
                  : "bg-gray-300";
            const summary = !s.enabled
              ? "Disabled"
              : st?.kind === "ok"
                ? `${st.toolCount} tool(s) · Healthy`
                : st?.kind === "auth_failed"
                  ? "Auth failed"
                  : st?.kind === "unreachable"
                    ? "Unreachable"
                    : st?.kind === "misconfigured"
                      ? "Misconfigured"
                      : "Checking…";
            const tools = toolsByServer[s.id];
            return (
              <li
                key={s.id}
                className="rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                  <button className="flex-1 text-left" onClick={() => void expand(s)}>
                    <div className="text-[0.9rem] font-medium text-foreground">{s.name}</div>
                    <div className="text-xs text-muted">
                      {s.url} · {summary}
                    </div>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex size-[26px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
                        aria-label={`${s.name} actions`}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(s)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void handleToggleEnabled(s)}>
                        {s.enabled ? "Disable" : "Enable"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void handleDelete(s.id)}>
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {expandedId === s.id && (
                  <div className="mt-2.5 pt-2.5">
                    {toolsLoading === s.id && (
                      <div className="text-xs text-muted">Loading tools…</div>
                    )}
                    {tools && tools.length === 0 && (
                      <div className="text-xs text-muted">No tools available.</div>
                    )}
                    {tools && tools.length > 0 && (
                      <>
                        <div className="mb-2 flex items-center justify-between text-xs text-muted">
                          <span>
                            {(s.enabledTools ?? tools.map((t) => t.name)).length} of {tools.length}{" "}
                            enabled
                          </span>
                          <div className="flex gap-3">
                            <button
                              className="text-xs text-muted hover:text-foreground transition-colors duration-150"
                              onClick={() =>
                                void handleSaveOne({
                                  id: s.id,
                                  name: s.name,
                                  url: s.url,
                                  transport: s.transport,
                                  auth: { type: "unchanged" },
                                  enabled: s.enabled,
                                  enabledTools: tools.map((t) => t.name),
                                  description: s.description,
                                })
                              }
                            >
                              Enable all
                            </button>
                            <button
                              className="text-xs text-muted hover:text-foreground transition-colors duration-150"
                              onClick={() =>
                                void handleSaveOne({
                                  id: s.id,
                                  name: s.name,
                                  url: s.url,
                                  transport: s.transport,
                                  auth: { type: "unchanged" },
                                  enabled: s.enabled,
                                  enabledTools: [],
                                  description: s.description,
                                })
                              }
                            >
                              Disable all
                            </button>
                          </div>
                        </div>
                        <ul className="flex flex-col gap-1">
                          {tools.map((t) => {
                            const enabledList = s.enabledTools ?? tools.map((x) => x.name);
                            const on = enabledList.includes(t.name);
                            return (
                              <li key={t.name} className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={(e) =>
                                    void handleToolToggle(s, t.name, e.target.checked)
                                  }
                                />
                                <code className="text-xs">
                                  {s.name}__{t.name}
                                </code>
                                {t.description && (
                                  <span className="text-xs text-muted">— {t.description}</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-1">
        <Button variant="primary" onClick={() => setAdding(true)}>
          + Add MCP server
        </Button>
      </div>

      {(adding || editing) && (
        <McpServerDialog
          key={editing?.id ?? "new"}
          open={true}
          initial={editing ?? undefined}
          onSave={async (input) => {
            await handleSaveOne(input);
            setEditing(null);
            setAdding(false);
          }}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
