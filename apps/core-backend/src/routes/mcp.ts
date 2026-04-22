import type { FastifyInstance, FastifyRequest } from "fastify";
import { McpServerSaveInputArraySchema, McpServerSaveInputSchema } from "../mcp/mcp.schema";
import { probeServer, McpClientWrapper } from "../mcp/mcp.client";
import { MCP_HEALTH_CACHE_TTL_MS } from "../mcp/mcp.constants";
import type { McpServerStatusPublic } from "../mcp/mcp.types";

export default async function mcpRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };
  const userId = (req: FastifyRequest) => {
    const id = req.user?.userId;
    if (!id) throw new Error("Unauthenticated");
    return id;
  };

  fastify.get("/api/mcp/servers", auth, async (req) => {
    return fastify.mcpService.getServers(userId(req));
  });

  fastify.put("/api/mcp/servers", auth, async (req, reply) => {
    const parsed = McpServerSaveInputArraySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "validation_failed", issues: parsed.error.issues };
    }
    const id = userId(req);
    const result = await fastify.mcpService.saveServers(id, parsed.data);
    fastify.mcpAdapter.invalidateUser(id);
    return result;
  });

  fastify.post("/api/mcp/servers/test", auth, async (req, reply) => {
    const parsed = McpServerSaveInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "validation_failed", issues: parsed.error.issues };
    }
    const i = parsed.data;
    if (i.auth.type === "unchanged") {
      reply.code(400);
      return { error: "cannot_test_unchanged_auth" };
    }
    const ephemeral = {
      id: i.id ?? "ephemeral",
      name: i.name,
      url: i.url,
      transport: i.transport,
      auth: i.auth,
      enabled: true,
      enabledTools: i.enabledTools,
      description: i.description,
      createdAt: "",
      updatedAt: "",
    } as const;
    // List tools against the ephemeral config directly — we can't use
    // mcpAdapter.listToolsForServer here because that requires a persisted
    // server row, and the user may be testing an unsaved server.
    let client: McpClientWrapper | null = null;
    try {
      client = await McpClientWrapper.connect(ephemeral as any);
      const tools = await client.listTools();
      const checkedAt = new Date().toISOString();
      return {
        ok: true,
        status: { kind: "ok" as const, toolCount: tools.length, checkedAt },
        tools,
      };
    } catch (err) {
      const checkedAt = new Date().toISOString();
      const message = (err as Error).message ?? String(err);
      const errKind = (err as { kind?: string }).kind;
      const statusKind: "auth_failed" | "unreachable" | "misconfigured" =
        errKind === "auth_failed"
          ? "auth_failed"
          : errKind === "unreachable" || errKind === "timeout"
            ? "unreachable"
            : "misconfigured";
      return {
        ok: false,
        status: { kind: statusKind, error: message, checkedAt },
      };
    } finally {
      await client?.close();
    }
  });

  fastify.get<{ Params: { id: string } }>("/api/mcp/servers/:id/tools", auth, async (req) => {
    return fastify.mcpAdapter.listToolsForServer(userId(req), req.params.id);
  });

  fastify.get("/api/mcp/status", auth, async (req): Promise<McpServerStatusPublic[]> => {
    const id = userId(req);
    const servers = await fastify.mcpService.getServers(id);
    const stale: { id: string; name: string }[] = [];
    const out: McpServerStatusPublic[] = [];

    for (const server of servers) {
      if (!server.enabled) {
        out.push({ id: server.id, name: server.name, status: { kind: "disabled" } });
        continue;
      }
      const cached = fastify.mcpHealth.get(id, server.id);
      if (cached && Date.now() - cached.checkedAt < MCP_HEALTH_CACHE_TTL_MS) {
        out.push({ id: server.id, name: server.name, status: cached.status });
      } else {
        stale.push({ id: server.id, name: server.name });
      }
    }

    if (stale.length) {
      const withSecrets = await fastify.mcpService.getServersWithSecrets(id);
      await Promise.all(
        stale.map(async (s) => {
          const secret = withSecrets.find((x) => x.id === s.id);
          if (!secret) {
            out.push({
              id: s.id,
              name: s.name,
              status: {
                kind: "misconfigured",
                error: "config not found",
                checkedAt: new Date().toISOString(),
              },
            });
            return;
          }
          const status = await probeServer(secret);
          fastify.mcpHealth.set(id, s.id, status);
          out.push({ id: s.id, name: s.name, status });
        }),
      );
    }
    return out;
  });
}
