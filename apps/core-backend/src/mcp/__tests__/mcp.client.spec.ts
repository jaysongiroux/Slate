jest.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  const mockConnect = jest.fn();
  const mockListTools = jest.fn();
  const mockCallTool = jest.fn();
  const mockClose = jest.fn();
  return {
    Client: jest.fn().mockImplementation(() => ({
      connect: mockConnect,
      listTools: mockListTools,
      callTool: mockCallTool,
      close: mockClose,
    })),
    __mocks: { mockConnect, mockListTools, mockCallTool, mockClose },
  };
});
jest.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: jest.fn(),
}));
jest.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: jest.fn(),
}));

import { McpClientWrapper, probeServer } from "../mcp.client";
import { McpConnectError } from "../mcp.errors";
const sdk = require("@modelcontextprotocol/sdk/client/index.js");

const cfg = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "linear",
  url: "https://x",
  transport: "sse" as const,
  auth: { type: "bearer" as const, token: "abc" },
  enabled: true,
  enabledTools: null,
  createdAt: "",
  updatedAt: "",
};

beforeEach(() => {
  sdk.__mocks.mockConnect.mockReset().mockResolvedValue(undefined);
  sdk.__mocks.mockListTools.mockReset().mockResolvedValue({
    tools: [{ name: "search", description: "Find", inputSchema: { type: "object" } }],
  });
  sdk.__mocks.mockCallTool
    .mockReset()
    .mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
  sdk.__mocks.mockClose.mockReset().mockResolvedValue(undefined);
});

describe("McpClientWrapper", () => {
  it("connects and lists tools", async () => {
    const c = await McpClientWrapper.connect(cfg);
    const tools = await c.listTools();
    expect(tools).toEqual([
      { name: "search", description: "Find", inputSchema: { type: "object" } },
    ]);
    await c.close();
    expect(sdk.__mocks.mockClose).toHaveBeenCalled();
  });

  it("maps a 401 to auth_failed", async () => {
    sdk.__mocks.mockConnect.mockRejectedValueOnce(
      Object.assign(new Error("401 Unauthorized"), { status: 401 }),
    );
    await expect(McpClientWrapper.connect(cfg)).rejects.toMatchObject({
      kind: "auth_failed",
    });
  });

  it("maps ECONNREFUSED to unreachable", async () => {
    sdk.__mocks.mockConnect.mockRejectedValueOnce(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:80"), { code: "ECONNREFUSED" }),
    );
    await expect(McpClientWrapper.connect(cfg)).rejects.toMatchObject({
      kind: "unreachable",
    });
  });

  it("maps a connect timeout", async () => {
    sdk.__mocks.mockConnect.mockImplementationOnce(() => new Promise(() => {}));
    await expect(McpClientWrapper.connect(cfg, { timeoutMs: 50 })).rejects.toMatchObject({
      kind: "timeout",
    });
  });
});

describe("probeServer", () => {
  it("returns ok with toolCount on a successful probe", async () => {
    const result = await probeServer(cfg);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.toolCount).toBe(1);
  });

  it("returns auth_failed on 401", async () => {
    sdk.__mocks.mockConnect.mockRejectedValueOnce(
      Object.assign(new Error("Unauthorized"), { status: 401 }),
    );
    const result = await probeServer(cfg);
    expect(result.kind).toBe("auth_failed");
  });
});
