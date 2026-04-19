import Fastify from "fastify";
import { Readable } from "node:stream";
import { HomeAssistantUpstreamError } from "../src/home-assistant/home-assistant.errors";
import homeAssistantRoutes from "../src/routes/home-assistant";

function createRouteTestApp(serviceOverrides: Record<string, jest.Mock> = {}) {
  const app = Fastify({ logger: false });
  const service = {
    listInstances: jest.fn(async () => [{ id: "ha-1", name: "Home", url: "http://ha.local" }]),
    addInstance: jest.fn(async () => ({ id: "ha-1", name: "Home", url: "http://ha.local" })),
    removeInstance: jest.fn(async () => undefined),
    getDashboards: jest.fn(async () => []),
    getDashboardSummary: jest.fn(async () => ({
      dashboard: { id: "main", title: "Main" },
      entities: [],
    })),
    getAreas: jest.fn(async () => []),
    getDevices: jest.fn(async () => []),
    getEntities: jest.fn(async () => []),
    getCameraSnapshot: jest.fn(async () => ({
      body: Readable.from(Buffer.from("jpeg")),
      contentType: "image/jpeg",
      status: 200,
    })),
    control: jest.fn(async () => ({ ok: true, state: null })),
    ...serviceOverrides,
  };

  app.decorate("homeAssistantService", service as any);
  app.decorate("authenticate", async (request: any, reply: any) => {
    if (request.headers.authorization !== "Bearer ok") {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    request.user = { userId: "user-1" };
  });
  app.decorate("authenticateAttachment", async (request: any, reply: any) => {
    const query = request.query as Record<string, unknown>;
    if (query.token !== "ok") {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    request.userSession = { userId: "user-1" };
  });

  return { app, service };
}

describe("Home Assistant routes", () => {
  it("rejects unauthenticated requests", async () => {
    const { app, service } = createRouteTestApp();
    await app.register(homeAssistantRoutes);

    const response = await app.inject({ method: "GET", url: "/api/home-assistant/instances" });

    expect(response.statusCode).toBe(401);
    expect(service.listInstances).not.toHaveBeenCalled();
    await app.close();
  });

  it("lists instances for the authenticated user", async () => {
    const { app, service } = createRouteTestApp();
    await app.register(homeAssistantRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/api/home-assistant/instances",
      headers: { authorization: "Bearer ok" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      instances: [{ id: "ha-1", name: "Home", url: "http://ha.local" }],
    });
    expect(service.listInstances).toHaveBeenCalledWith("user-1");
    await app.close();
  });

  it("formats add-instance errors", async () => {
    const { app } = createRouteTestApp({
      addInstance: jest.fn(async () => {
        throw new HomeAssistantUpstreamError(401, "bad token");
      }),
    });
    await app.register(homeAssistantRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/api/home-assistant/instances",
      headers: { authorization: "Bearer ok" },
      payload: { url: "http://ha.local", token: "bad-token", name: "Home" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      code: "home_assistant_auth_failed",
      error: "Home Assistant rejected this token. Check the long-lived access token and try again.",
    });
    await app.close();
  });

  it("formats unsupported control errors", async () => {
    const { app } = createRouteTestApp({
      control: jest.fn(async () => {
        throw new Error("unsupported_control");
      }),
    });
    await app.register(homeAssistantRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/api/home-assistant/ha-1/control",
      headers: { authorization: "Bearer ok" },
      payload: { entityId: "sensor.temperature", control: "toggle" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      code: "home_assistant_unsupported_control",
      error: "Slate does not support controls for this entity yet.",
    });
    await app.close();
  });

  it("formats dashboard network failures", async () => {
    const { app } = createRouteTestApp({
      getDashboardSummary: jest.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    await app.register(homeAssistantRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/api/home-assistant/ha-1/dashboards/dashboard-cameras",
      headers: { authorization: "Bearer ok" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      code: "home_assistant_unreachable",
      error: "Could not reach this Home Assistant instance. Check the URL and network.",
    });
    await app.close();
  });

  it("proxies camera snapshots for authenticated image requests", async () => {
    const { app, service } = createRouteTestApp();
    await app.register(homeAssistantRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/api/home-assistant/ha-1/cameras/camera.front_door/snapshot?token=ok",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(response.body).toBe("jpeg");
    expect(service.getCameraSnapshot).toHaveBeenCalledWith("user-1", "ha-1", "camera.front_door");
    await app.close();
  });
});
