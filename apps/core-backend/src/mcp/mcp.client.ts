import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { MCP_CONNECT_TIMEOUT_MS, MCP_TOOL_CALL_TIMEOUT_MS } from "./mcp.constants";
import { McpConnectError, McpToolCallError } from "./mcp.errors";
import type { McpServerDecrypted, McpServerStatus, McpToolDescriptor } from "./mcp.types";

function buildHeaders(cfg: McpServerDecrypted): Record<string, string> {
  if (cfg.auth.type === "bearer") return { Authorization: `Bearer ${cfg.auth.token}` };
  if (cfg.auth.type === "headers") {
    return Object.fromEntries(cfg.auth.headers.map((h) => [h.name, h.value]));
  }
  return {};
}

function buildTransport(cfg: McpServerDecrypted) {
  const url = new URL(cfg.url);
  const headers = buildHeaders(cfg);
  if (cfg.transport === "sse") {
    return new SSEClientTransport(url, { requestInit: { headers } });
  }
  // http and streamable-http both use the streamable HTTP transport
  return new StreamableHTTPClientTransport(url, { requestInit: { headers } });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new McpConnectError("timeout", `${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function mapConnectError(err: unknown): McpConnectError {
  if (err instanceof McpConnectError) return err;
  const e = err as { status?: number; code?: string; message?: string };
  const msg = e?.message ?? String(err);
  if (e?.status === 401 || e?.status === 403) return new McpConnectError("auth_failed", msg);
  if (e?.code === "ECONNREFUSED" || e?.code === "ENOTFOUND" || e?.code === "EAI_AGAIN") {
    return new McpConnectError("unreachable", msg);
  }
  if (/timeout/i.test(msg)) return new McpConnectError("timeout", msg);
  if (/parse|json|protocol/i.test(msg)) return new McpConnectError("bad_response", msg);
  return new McpConnectError("misconfigured", msg);
}

export class McpClientWrapper {
  private constructor(private client: Client) {}

  static async connect(
    cfg: McpServerDecrypted,
    opts: { timeoutMs?: number } = {},
  ): Promise<McpClientWrapper> {
    const client = new Client(
      { name: "slate-core-backend", version: "1.0.0" },
      { capabilities: {} },
    );
    const transport = buildTransport(cfg);
    try {
      await withTimeout(
        client.connect(transport),
        opts.timeoutMs ?? MCP_CONNECT_TIMEOUT_MS,
        "connect",
      );
    } catch (err) {
      throw mapConnectError(err);
    }
    return new McpClientWrapper(client);
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    try {
      const result: any = await this.client.listTools();
      const tools: any[] = result?.tools ?? [];
      return tools.map((t) => ({
        name: String(t.name),
        description: t.description ? String(t.description) : undefined,
        inputSchema: (t.inputSchema ?? { type: "object" }) as Record<string, unknown>,
      }));
    } catch (err) {
      throw mapConnectError(err);
    }
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    try {
      const result: any = await withTimeout(
        this.client.callTool({ name, arguments: (args ?? {}) as Record<string, unknown> }),
        MCP_TOOL_CALL_TIMEOUT_MS,
        `callTool(${name})`,
      );
      // Normalize MCP content blocks to a plain string the LLM can consume.
      if (Array.isArray(result?.content)) {
        return result.content
          .map((c: any) => (c?.type === "text" ? String(c.text ?? "") : JSON.stringify(c)))
          .join("\n");
      }
      return result;
    } catch (err) {
      if (err instanceof McpConnectError && err.kind === "timeout") {
        throw new McpToolCallError("timeout", err.message);
      }
      throw new McpToolCallError("transport_error", (err as Error).message);
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      /* idempotent close */
    }
  }
}

export async function probeServer(cfg: McpServerDecrypted): Promise<McpServerStatus> {
  const checkedAt = new Date().toISOString();
  let client: McpClientWrapper | null = null;
  try {
    client = await McpClientWrapper.connect(cfg);
    const tools = await client.listTools();
    return { kind: "ok", toolCount: tools.length, checkedAt };
  } catch (err) {
    if (err instanceof McpConnectError) {
      if (err.kind === "auth_failed") return { kind: "auth_failed", error: err.message, checkedAt };
      if (err.kind === "unreachable") return { kind: "unreachable", error: err.message, checkedAt };
      if (err.kind === "timeout") return { kind: "unreachable", error: err.message, checkedAt };
      return { kind: "misconfigured", error: err.message, checkedAt };
    }
    return { kind: "misconfigured", error: (err as Error).message, checkedAt };
  } finally {
    await client?.close();
  }
}
