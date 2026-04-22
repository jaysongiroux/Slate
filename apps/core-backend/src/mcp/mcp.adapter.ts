import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { LRUCache } from "lru-cache";
import { McpClientWrapper } from "./mcp.client";
import { McpHealthCache } from "./mcp.health";
import { McpService } from "./mcp.service";
import { jsonSchemaToZod } from "./json-schema-to-zod";
import { MCP_TOOL_NAME_SEPARATOR } from "./mcp.constants";
import type { McpServerDecrypted, McpToolDescriptor } from "./mcp.types";

function cacheKey(userId: string, serverId: string): string {
  return `${userId}:${serverId}`;
}

function mcpToolToLangChainTool(
  server: McpServerDecrypted,
  tool: McpToolDescriptor,
): DynamicStructuredTool {
  const prefixedName = `${server.name}${MCP_TOOL_NAME_SEPARATOR}${tool.name}`;
  const schema = jsonSchemaToZod(tool.inputSchema as any) as z.ZodObject<z.ZodRawShape>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (DynamicStructuredTool as any)({
    name: prefixedName,
    description: tool.description ?? "",
    schema,
    func: async (args: unknown) => {
      let client: McpClientWrapper | null = null;
      try {
        client = await McpClientWrapper.connect(server);
        const result = await client.callTool(tool.name, args);
        return typeof result === "string" ? result : JSON.stringify(result);
      } catch (err) {
        return `Error calling ${prefixedName}: ${(err as Error).message}`;
      } finally {
        await client?.close();
      }
    },
  }) as DynamicStructuredTool;
}

export class McpAdapter {
  constructor(
    private mcpService: Pick<McpService, "getServersWithSecrets">,
    private health: McpHealthCache,
    private toolCache: LRUCache<string, DynamicStructuredTool[]>,
  ) {}

  async getToolsForUser(userId: string): Promise<DynamicStructuredTool[]> {
    const servers = (await this.mcpService.getServersWithSecrets(userId)).filter((s) => s.enabled);
    const results = await Promise.all(servers.map((s) => this.toolsForOneServer(userId, s)));
    return results.flat();
  }

  async listToolsForServer(userId: string, serverId: string): Promise<McpToolDescriptor[]> {
    const all = await this.mcpService.getServersWithSecrets(userId);
    const server = all.find((s) => s.id === serverId);
    if (!server) throw new Error(`Server not found: ${serverId}`);
    let client: McpClientWrapper | null = null;
    try {
      client = await McpClientWrapper.connect(server);
      return await client.listTools();
    } finally {
      await client?.close();
    }
  }

  invalidateUser(userId: string): void {
    const prefix = `${userId}:`;
    for (const k of this.toolCache.keys()) {
      if (k.startsWith(prefix)) this.toolCache.delete(k);
    }
    this.health.invalidate(userId);
  }

  private async toolsForOneServer(
    userId: string,
    server: McpServerDecrypted,
  ): Promise<DynamicStructuredTool[]> {
    const k = cacheKey(userId, server.id);
    const cached = this.toolCache.get(k);
    if (cached) return cached;

    let client: McpClientWrapper | null = null;
    try {
      client = await McpClientWrapper.connect(server);
      const tools = await client.listTools();
      const allowed =
        server.enabledTools == null
          ? tools
          : tools.filter((t) => server.enabledTools!.includes(t.name));
      const langchainTools = allowed.map((t) => mcpToolToLangChainTool(server, t));
      this.toolCache.set(k, langchainTools);
      this.health.set(userId, server.id, {
        kind: "ok",
        toolCount: langchainTools.length,
        checkedAt: new Date().toISOString(),
      });
      return langchainTools;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      const kind = ((err as any).kind ?? "misconfigured") as
        | "auth_failed"
        | "unreachable"
        | "timeout"
        | "bad_response"
        | "misconfigured";
      const statusKind =
        kind === "auth_failed"
          ? "auth_failed"
          : kind === "unreachable" || kind === "timeout"
            ? "unreachable"
            : "misconfigured";
      this.health.set(userId, server.id, {
        kind: statusKind,
        error: msg,
        checkedAt: new Date().toISOString(),
      });
      return []; // fail-soft
    } finally {
      await client?.close();
    }
  }
}
