import Fastify from "fastify";
import forgeRoutes from "../../routes/forge";

function mockFastify(deps: any) {
  const app = Fastify();
  app.decorate("authenticate", async (req: any) => {
    req.user = { userId: deps.userId ?? "u1" };
  });
  app.decorate("forgeService", deps.forgeService);
  app.decorate("forgeCache", deps.forgeCache);
  app.register(forgeRoutes);
  return app;
}

function buildCache() {
  const store = new Map<string, unknown>();
  return {
    getOrLoad: jest.fn(async (key: string, load: () => Promise<unknown>) => {
      if (store.has(key)) return store.get(key);
      const v = await load();
      store.set(key, v);
      return v;
    }),
    invalidatePrefix: jest.fn((prefix: string) => {
      for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
    }),
  };
}

describe("forge routes", () => {
  it("GET /api/forge/instances returns instances for the authenticated user", async () => {
    const app = mockFastify({
      forgeService: {
        listInstances: jest.fn().mockResolvedValue([
          { id: "i1", name: "work", provider: "github", baseUrl: "https://api.github.com" },
        ]),
      },
      forgeCache: buildCache(),
    });
    const res = await app.inject({ method: "GET", url: "/api/forge/instances" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      instances: [
        { id: "i1", name: "work", provider: "github", baseUrl: "https://api.github.com" },
      ],
    });
  });

  it("POST /api/forge/instances delegates to service.addInstance and returns instance", async () => {
    const addInstance = jest.fn().mockResolvedValue({
      id: "i2",
      name: "x",
      provider: "gitlab",
      baseUrl: "https://gitlab.com/api/v4",
    });
    const app = mockFastify({
      forgeService: { addInstance },
      forgeCache: buildCache(),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/forge/instances",
      payload: { provider: "gitlab", baseUrl: "https://gitlab.com", token: "t" },
    });
    expect(res.statusCode).toBe(200);
    expect(addInstance).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ provider: "gitlab", token: "t" }),
    );
  });

  it("POST /api/forge/instances maps token errors to FORGE_TOKEN_INVALID", async () => {
    const addInstance = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error("bad credentials"), { status: 401 }));
    const app = mockFastify({
      forgeService: { addInstance },
      forgeCache: buildCache(),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/forge/instances",
      payload: { provider: "github", baseUrl: "https://api.github.com", token: "bad" },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload).error).toBe("FORGE_TOKEN_INVALID");
  });

  it("GET /api/forge/:id/counts caches on repeated call", async () => {
    const getCounts = jest.fn().mockResolvedValue({
      myPRs: 1,
      reviewing: 2,
      notifications: 3,
      assignedIssues: 4,
    });
    const getProviderForInstance = jest.fn().mockResolvedValue({ getCounts });
    const app = mockFastify({
      forgeService: { getProviderForInstance },
      forgeCache: buildCache(),
    });
    await app.inject({ method: "GET", url: "/api/forge/i1/counts" });
    await app.inject({ method: "GET", url: "/api/forge/i1/counts" });
    expect(getCounts).toHaveBeenCalledTimes(1);
  });

  it("POST /api/forge/:id/refresh invalidates that instance's cache", async () => {
    const cache = buildCache();
    const getCounts = jest
      .fn()
      .mockResolvedValueOnce({ myPRs: 1, reviewing: 0, notifications: 0, assignedIssues: 0 })
      .mockResolvedValueOnce({ myPRs: 2, reviewing: 0, notifications: 0, assignedIssues: 0 });
    const app = mockFastify({
      forgeService: {
        getProviderForInstance: jest.fn().mockResolvedValue({ getCounts }),
      },
      forgeCache: cache,
    });
    await app.inject({ method: "GET", url: "/api/forge/i1/counts" });
    await app.inject({ method: "POST", url: "/api/forge/i1/refresh", payload: {} });
    await app.inject({ method: "GET", url: "/api/forge/i1/counts" });
    expect(getCounts).toHaveBeenCalledTimes(2);
    expect(cache.invalidatePrefix).toHaveBeenCalledWith("u1:i1:");
  });

  it("DELETE /api/forge/instances/:id invalidates cache", async () => {
    const cache = buildCache();
    const removeInstance = jest.fn().mockResolvedValue(undefined);
    const app = mockFastify({
      forgeService: { removeInstance },
      forgeCache: cache,
    });
    const res = await app.inject({ method: "DELETE", url: "/api/forge/instances/i1" });
    expect(res.statusCode).toBe(200);
    expect(cache.invalidatePrefix).toHaveBeenCalledWith("u1:i1:");
  });
});
