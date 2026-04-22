import { McpServerConfigSchema, McpServersSettingSchema } from "../mcp.schema";

const validServer = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "linear",
  url: "https://mcp.linear.app/sse",
  transport: "sse" as const,
  auth: { type: "bearer" as const, tokenEncrypted: "abc.def.123" },
  enabled: true,
  enabledTools: null,
  createdAt: "2026-04-21T00:00:00.000Z",
  updatedAt: "2026-04-21T00:00:00.000Z",
};

describe("McpServerConfigSchema", () => {
  it("accepts a valid server", () => {
    expect(() => McpServerConfigSchema.parse(validServer)).not.toThrow();
  });

  it("rejects names outside the regex", () => {
    expect(() => McpServerConfigSchema.parse({ ...validServer, name: "Linear" })).toThrow();
    expect(() => McpServerConfigSchema.parse({ ...validServer, name: "with space" })).toThrow();
    expect(() => McpServerConfigSchema.parse({ ...validServer, name: "" })).toThrow();
    expect(() => McpServerConfigSchema.parse({ ...validServer, name: "x".repeat(33) })).toThrow();
  });

  it("rejects unknown transport", () => {
    expect(() => McpServerConfigSchema.parse({ ...validServer, transport: "stdio" })).toThrow();
  });

  it("requires non-empty tokenEncrypted for bearer", () => {
    expect(() =>
      McpServerConfigSchema.parse({
        ...validServer,
        auth: { type: "bearer", tokenEncrypted: "" },
      }),
    ).toThrow();
  });

  it("accepts none auth", () => {
    expect(() =>
      McpServerConfigSchema.parse({ ...validServer, auth: { type: "none" } }),
    ).not.toThrow();
  });

  it("accepts headers auth with array", () => {
    expect(() =>
      McpServerConfigSchema.parse({
        ...validServer,
        auth: {
          type: "headers",
          headersEncrypted: [{ name: "X-Token", valueEncrypted: "abc.def.123" }],
        },
      }),
    ).not.toThrow();
  });

  it("accepts enabledTools as array or null", () => {
    expect(() => McpServerConfigSchema.parse({ ...validServer, enabledTools: [] })).not.toThrow();
    expect(() =>
      McpServerConfigSchema.parse({ ...validServer, enabledTools: ["a", "b"] }),
    ).not.toThrow();
  });
});

describe("McpServersSettingSchema", () => {
  it("requires version: 1", () => {
    expect(() => McpServersSettingSchema.parse({ version: 2, servers: [] })).toThrow();
  });

  it("accepts an empty server list", () => {
    expect(() => McpServersSettingSchema.parse({ version: 1, servers: [] })).not.toThrow();
  });
});
