import { McpConnectError, McpToolCallError, isMcpConnectError } from "../mcp.errors";

describe("mcp.errors", () => {
  it("creates an unreachable connect error", () => {
    const err = new McpConnectError("unreachable", "ECONNREFUSED");
    expect(err.kind).toBe("unreachable");
    expect(err.message).toBe("ECONNREFUSED");
    expect(err).toBeInstanceOf(Error);
  });

  it("creates a tool-call error", () => {
    const err = new McpToolCallError("timeout", "Took too long");
    expect(err.kind).toBe("timeout");
    expect(err.message).toBe("Took too long");
  });

  it("isMcpConnectError discriminates", () => {
    expect(isMcpConnectError(new McpConnectError("auth_failed", "401"))).toBe(true);
    expect(isMcpConnectError(new Error("plain"))).toBe(false);
  });
});
