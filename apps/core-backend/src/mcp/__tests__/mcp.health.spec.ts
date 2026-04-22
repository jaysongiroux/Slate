import { McpHealthCache } from "../mcp.health";

describe("McpHealthCache", () => {
  it("stores and retrieves a status", () => {
    const cache = new McpHealthCache();
    const status = { kind: "ok" as const, toolCount: 3, checkedAt: new Date().toISOString() };
    cache.set("u1", "s1", status);
    const got = cache.get("u1", "s1");
    expect(got?.status).toEqual(status);
    expect(typeof got?.checkedAt).toBe("number");
  });

  it("isolates by user", () => {
    const cache = new McpHealthCache();
    const status = { kind: "ok" as const, toolCount: 1, checkedAt: new Date().toISOString() };
    cache.set("u1", "s1", status);
    expect(cache.get("u2", "s1")).toBeUndefined();
  });

  it("invalidate(userId, serverId) removes one entry", () => {
    const cache = new McpHealthCache();
    const status = { kind: "ok" as const, toolCount: 1, checkedAt: new Date().toISOString() };
    cache.set("u1", "s1", status);
    cache.set("u1", "s2", status);
    cache.invalidate("u1", "s1");
    expect(cache.get("u1", "s1")).toBeUndefined();
    expect(cache.get("u1", "s2")).toBeDefined();
  });

  it("invalidate(userId) removes all entries for a user", () => {
    const cache = new McpHealthCache();
    const status = { kind: "ok" as const, toolCount: 1, checkedAt: new Date().toISOString() };
    cache.set("u1", "s1", status);
    cache.set("u1", "s2", status);
    cache.set("u2", "s1", status);
    cache.invalidate("u1");
    expect(cache.get("u1", "s1")).toBeUndefined();
    expect(cache.get("u1", "s2")).toBeUndefined();
    expect(cache.get("u2", "s1")).toBeDefined();
  });
});
