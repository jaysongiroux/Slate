jest.mock("../mcp.client", () => {
  const close = jest.fn().mockResolvedValue(undefined);
  return {
    McpClientWrapper: {
      connect: jest.fn().mockResolvedValue({
        listTools: jest.fn().mockResolvedValue([
          {
            name: "search",
            description: "Find",
            inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
          },
          { name: "create", description: "Create", inputSchema: { type: "object" } },
        ]),
        callTool: jest.fn().mockResolvedValue("result-text"),
        close,
      }),
    },
    probeServer: jest.fn(),
  };
});

import { LRUCache } from "lru-cache";
import { McpAdapter } from "../mcp.adapter";
import { McpHealthCache } from "../mcp.health";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { McpClientWrapper } from "../mcp.client";

const baseSecret = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "linear",
  url: "https://x",
  transport: "sse" as const,
  auth: { type: "none" as const },
  enabled: true,
  enabledTools: null,
  createdAt: "",
  updatedAt: "",
};

function makeService(servers: any[]) {
  return {
    getServersWithSecrets: jest.fn().mockResolvedValue(servers),
  } as any;
}

describe("McpAdapter.getToolsForUser", () => {
  it("returns prefixed tools for an enabled server", async () => {
    const adapter = new McpAdapter(
      makeService([baseSecret]),
      new McpHealthCache(),
      new LRUCache({ max: 100, ttl: 60_000 }),
    );
    const tools = await adapter.getToolsForUser("u1");
    expect(tools.map((t) => t.name).sort()).toEqual(["linear__create", "linear__search"]);
  });

  it("filters by enabledTools allowlist", async () => {
    const adapter = new McpAdapter(
      makeService([{ ...baseSecret, enabledTools: ["search"] }]),
      new McpHealthCache(),
      new LRUCache({ max: 100, ttl: 60_000 }),
    );
    const tools = await adapter.getToolsForUser("u1");
    expect(tools.map((t) => t.name)).toEqual(["linear__search"]);
  });

  it("skips disabled servers entirely", async () => {
    const adapter = new McpAdapter(
      makeService([{ ...baseSecret, enabled: false }]),
      new McpHealthCache(),
      new LRUCache({ max: 100, ttl: 60_000 }),
    );
    expect(await adapter.getToolsForUser("u1")).toEqual([]);
  });

  it("fail-soft: an unhealthy server is excluded but does not throw", async () => {
    (McpClientWrapper.connect as jest.Mock).mockRejectedValueOnce(new Error("unreachable"));
    const health = new McpHealthCache();
    const adapter = new McpAdapter(
      makeService([
        baseSecret,
        { ...baseSecret, id: "22222222-2222-4222-8222-222222222222", name: "other" },
      ]),
      health,
      new LRUCache({ max: 100, ttl: 60_000 }),
    );
    const tools = await adapter.getToolsForUser("u1");
    expect(
      tools.map((t) => (t as DynamicStructuredTool).name).every((n) => n.startsWith("other__")),
    ).toBe(true);
    expect(health.get("u1", baseSecret.id)?.status.kind).not.toBe("ok");
  });

  it("uses the tool cache on a second call for the same user/server", async () => {
    const cache = new LRUCache<string, any>({ max: 100, ttl: 60_000 });
    const adapter = new McpAdapter(makeService([baseSecret]), new McpHealthCache(), cache);
    const connectSpy = McpClientWrapper.connect as jest.Mock;
    connectSpy.mockClear();
    await adapter.getToolsForUser("u1");
    await adapter.getToolsForUser("u1");
    expect(connectSpy).toHaveBeenCalledTimes(1); // second call hit the cache
  });

  it("invalidateUser drops cached entries", async () => {
    const cache = new LRUCache<string, any>({ max: 100, ttl: 60_000 });
    const adapter = new McpAdapter(makeService([baseSecret]), new McpHealthCache(), cache);
    await adapter.getToolsForUser("u1");
    adapter.invalidateUser("u1");
    const connectSpy = McpClientWrapper.connect as jest.Mock;
    connectSpy.mockClear();
    await adapter.getToolsForUser("u1");
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });
});

describe("Tool name routing", () => {
  it("the tool's func calls the underlying MCP tool by unprefixed name", async () => {
    const adapter = new McpAdapter(
      makeService([baseSecret]),
      new McpHealthCache(),
      new LRUCache({ max: 100, ttl: 60_000 }),
    );
    const tools = await adapter.getToolsForUser("u1");
    const search = tools.find((t) => t.name === "linear__search")! as DynamicStructuredTool;
    const result = await (search as any).func({ q: "hello" });
    expect(typeof result).toBe("string");
  });
});
