import Fastify from "fastify";
import mcpRoutes from "../../routes/mcp";

function buildApp(deps: any) {
  const app = Fastify();
  app.decorate("authenticate", async (req: any) => {
    req.user = { userId: "u1" };
  });
  app.decorate("mcpService", deps.mcpService);
  app.decorate("mcpAdapter", deps.mcpAdapter);
  app.decorate("mcpHealth", deps.mcpHealth);
  app.register(mcpRoutes);
  return app;
}

describe("mcp routes", () => {
  it("GET /api/mcp/servers returns sanitized list", async () => {
    const app = buildApp({
      mcpService: {
        getServers: jest
          .fn()
          .mockResolvedValue([{ id: "s1", name: "linear", auth: { type: "none" } }]),
      },
      mcpAdapter: { listToolsForServer: jest.fn() },
      mcpHealth: { get: jest.fn(), set: jest.fn() },
    });
    const res = await app.inject({ method: "GET", url: "/api/mcp/servers" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([{ id: "s1", name: "linear", auth: { type: "none" } }]);
  });

  it("PUT /api/mcp/servers calls saveServers and invalidates caches", async () => {
    const saveServers = jest.fn().mockResolvedValue([]);
    const invalidateUser = jest.fn();
    const app = buildApp({
      mcpService: { getServers: jest.fn(), saveServers },
      mcpAdapter: { invalidateUser, listToolsForServer: jest.fn() },
      mcpHealth: { invalidate: jest.fn() },
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/mcp/servers",
      payload: [
        {
          name: "linear",
          url: "https://x",
          transport: "sse",
          auth: { type: "none" },
          enabled: true,
          enabledTools: null,
        },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(saveServers).toHaveBeenCalledWith("u1", expect.any(Array));
    expect(invalidateUser).toHaveBeenCalledWith("u1");
  });

  it("PUT returns 400 on Zod validation failure", async () => {
    const app = buildApp({
      mcpService: { saveServers: jest.fn() },
      mcpAdapter: { invalidateUser: jest.fn(), listToolsForServer: jest.fn() },
      mcpHealth: { invalidate: jest.fn() },
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/mcp/servers",
      payload: [{ name: "INVALID NAME", url: "not-a-url", transport: "stdio" }],
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/mcp/status returns disabled for disabled servers and re-probes stale", async () => {
    jest.resetModules();
    jest.doMock("../mcp.client", () => ({
      probeServer: jest.fn().mockResolvedValue({ kind: "ok", toolCount: 2, checkedAt: "x" }),
    }));
    const mcpRoutes2 = require("../../routes/mcp").default;
    const fresh = new Date().toISOString();
    const app = Fastify();
    app.decorate("authenticate", async (req: any) => {
      req.user = { userId: "u1" };
    });
    app.decorate("mcpService", {
      getServers: jest.fn().mockResolvedValue([
        { id: "s1", name: "off", enabled: false, auth: { type: "none" } },
        { id: "s2", name: "on", enabled: true, auth: { type: "none" } },
      ]),
      getServersWithSecrets: jest.fn().mockResolvedValue([
        {
          id: "s2",
          name: "on",
          enabled: true,
          auth: { type: "none" },
          transport: "sse",
          url: "https://x",
          enabledTools: null,
          createdAt: "",
          updatedAt: "",
        },
      ]),
    } as any);
    app.decorate("mcpAdapter", { listToolsForServer: jest.fn() } as any);
    app.decorate("mcpHealth", { get: jest.fn().mockReturnValue(undefined), set: jest.fn() } as any);
    app.register(mcpRoutes2);
    const res = await app.inject({ method: "GET", url: "/api/mcp/status" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    const off = body.find((x: any) => x.id === "s1");
    const on = body.find((x: any) => x.id === "s2");
    expect(off.status.kind).toBe("disabled");
    expect(on.status.kind).toBe("ok");
  });
});
