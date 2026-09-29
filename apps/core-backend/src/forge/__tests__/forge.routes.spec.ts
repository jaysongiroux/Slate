import Fastify from "fastify";
import forgeRoutes from "../../routes/forge";

function mockFastify(deps: any) {
  const app = Fastify();
  app.decorate("authenticate", async (req: any) => {
    if (deps.unauthenticated) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
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
  it("search-prs requires authentication and validates query, state, and cursor", async () => {
    const searchPullRequests = jest.fn();
    const forgeService = {
      getProviderForInstance: jest.fn().mockResolvedValue({ searchPullRequests }),
    };
    const unauthenticated = mockFastify({
      forgeService,
      forgeCache: buildCache(),
      unauthenticated: true,
    });
    expect(
      (await unauthenticated.inject({ method: "GET", url: "/api/forge/i1/search-prs?q=fix" }))
        .statusCode,
    ).toBe(401);
    const app = mockFastify({ forgeService, forgeCache: buildCache() });
    for (const suffix of [
      "",
      "?q=%20",
      "?q=fix&state=invalid",
      "?q=fix&cursor=0",
      `?q=${"x".repeat(201)}`,
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/forge/i1/search-prs${suffix}`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("FORGE_INVALID_QUERY");
    }
    expect(searchPullRequests).not.toHaveBeenCalled();
  });

  it("search-prs uses account, query, state, and cursor in cache identity and refreshes", async () => {
    const cache = buildCache();
    const searchPullRequests = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const getProviderForInstance = jest.fn().mockResolvedValue({ searchPullRequests });
    const app1 = mockFastify({
      forgeService: { getProviderForInstance },
      forgeCache: cache,
      userId: "u1",
    });
    const app2 = mockFastify({
      forgeService: { getProviderForInstance },
      forgeCache: cache,
      userId: "u2",
    });
    const urls = [
      "/api/forge/i1/search-prs?q=fix&state=all",
      "/api/forge/i1/search-prs?q=fix&state=open",
      "/api/forge/i1/search-prs?q=other&state=all",
      "/api/forge/i1/search-prs?q=fix&state=all&cursor=2",
      "/api/forge/i2/search-prs?q=fix&state=all",
    ];
    for (const url of urls)
      expect((await app1.inject({ method: "GET", url })).statusCode).toBe(200);
    await app1.inject({ method: "GET", url: urls[0] });
    await app2.inject({ method: "GET", url: urls[0] });
    expect(searchPullRequests).toHaveBeenCalledTimes(6);
    expect(getProviderForInstance).toHaveBeenCalledWith("u2", "i1");
    expect(searchPullRequests).toHaveBeenCalledWith("fix", "all", "2");
    await app1.inject({ method: "POST", url: "/api/forge/i1/refresh", payload: {} });
    await app1.inject({ method: "GET", url: urls[0] });
    expect(searchPullRequests).toHaveBeenCalledTimes(7);
  });

  it("search-prs maps provider validation and rate-limit failures", async () => {
    const searchPullRequests = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("bad query"), { status: 422 }))
      .mockRejectedValueOnce(Object.assign(new Error("API rate limit exceeded"), { status: 403 }));
    const app = mockFastify({
      forgeService: { getProviderForInstance: jest.fn().mockResolvedValue({ searchPullRequests }) },
      forgeCache: buildCache(),
    });
    const bad = await app.inject({ method: "GET", url: "/api/forge/i1/search-prs?q=bad" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("FORGE_INVALID_QUERY");
    const limited = await app.inject({ method: "GET", url: "/api/forge/i1/search-prs?q=rate" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe("FORGE_RATE_LIMITED");
  });

  it("GET /api/forge/instances returns instances for the authenticated user", async () => {
    const app = mockFastify({
      forgeService: {
        listInstances: jest
          .fn()
          .mockResolvedValue([
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

  it("GET /api/forge/:id/repo-prs passes nested GitLab paths via query param", async () => {
    const listRepoPullRequests = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const app = mockFastify({
      forgeService: {
        getProviderForInstance: jest.fn().mockResolvedValue({ listRepoPullRequests }),
      },
      forgeCache: buildCache(),
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/forge/i1/repo-prs?repo=acme%2Fcommon%2Feng_portals",
    });
    expect(res.statusCode).toBe(200);
    expect(listRepoPullRequests).toHaveBeenCalledWith(
      "acme/common/eng_portals",
      undefined,
      undefined,
    );
  });

  it("repo-prs/search searches a nested project and keys cached pages by query", async () => {
    const cache = buildCache();
    const listRepoPullRequests = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const app = mockFastify({
      forgeService: {
        getProviderForInstance: jest.fn().mockResolvedValue({ listRepoPullRequests }),
      },
      forgeCache: cache,
    });
    const base = "/api/forge/i1/repo-prs/search?repo=acme%2Fcommon%2Feng_portals";
    for (const suffix of ["&q=auth", "&q=auth", "&q=auth&cursor=2", "&q=login"]) {
      expect((await app.inject({ method: "GET", url: base + suffix })).statusCode).toBe(200);
    }
    expect(listRepoPullRequests).toHaveBeenCalledTimes(3);
    expect(listRepoPullRequests).toHaveBeenCalledWith("acme/common/eng_portals", "2", "auth");
    expect(listRepoPullRequests).toHaveBeenCalledWith(
      "acme/common/eng_portals",
      undefined,
      "login",
    );
    await app.inject({ method: "POST", url: "/api/forge/i1/refresh", payload: {} });
    await app.inject({ method: "GET", url: base + "&q=auth" });
    expect(listRepoPullRequests).toHaveBeenCalledTimes(4);
  });

  it("repo-prs/search rejects blank or invalid searches and requires authentication", async () => {
    const listRepoPullRequests = jest.fn();
    const forgeService = {
      getProviderForInstance: jest.fn().mockResolvedValue({ listRepoPullRequests }),
    };
    const app = mockFastify({ forgeService, forgeCache: buildCache() });
    const base = "/api/forge/i1/repo-prs/search?repo=acme%2Fapp";
    for (const suffix of ["", "&q=%20", `&q=${"x".repeat(201)}`, "&q=fix&cursor=0"]) {
      const response = await app.inject({ method: "GET", url: base + suffix });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("FORGE_INVALID_QUERY");
    }
    expect(listRepoPullRequests).not.toHaveBeenCalled();
    const unauthenticated = mockFastify({
      forgeService,
      forgeCache: buildCache(),
      unauthenticated: true,
    });
    expect((await unauthenticated.inject({ method: "GET", url: base + "&q=fix" })).statusCode).toBe(
      401,
    );
  });

  it("GET /api/forge/:id/repo-issues passes nested GitLab paths via query param", async () => {
    const listRepoIssues = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const app = mockFastify({
      forgeService: {
        getProviderForInstance: jest.fn().mockResolvedValue({ listRepoIssues }),
      },
      forgeCache: buildCache(),
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/forge/i1/repo-issues?repo=acme/engineering",
    });
    expect(res.statusCode).toBe(200);
    expect(listRepoIssues).toHaveBeenCalledWith("acme/engineering", undefined);
  });
});
