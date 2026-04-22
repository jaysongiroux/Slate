import { z } from "zod";
import { MCP_NAME_REGEX } from "./mcp.constants";

export const McpTransportSchema = z.enum(["http", "sse", "streamable-http"]);

export const McpAuthStoredSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("bearer"),
    tokenEncrypted: z.string().min(1),
  }),
  z.object({
    type: z.literal("headers"),
    headersEncrypted: z.array(
      z.object({ name: z.string().min(1), valueEncrypted: z.string().min(1) }),
    ),
  }),
]);

export const McpServerConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().regex(MCP_NAME_REGEX),
  url: z.string().url(),
  transport: McpTransportSchema,
  auth: McpAuthStoredSchema,
  enabled: z.boolean(),
  enabledTools: z.array(z.string()).nullable(),
  description: z.string().max(500).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const McpServersSettingSchema = z.object({
  version: z.literal(1),
  servers: z.array(McpServerConfigSchema),
});

export const McpServerSaveInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().regex(MCP_NAME_REGEX),
  url: z.string().url(),
  transport: McpTransportSchema,
  auth: z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({ type: z.literal("bearer"), token: z.string().min(1) }),
    z.object({
      type: z.literal("headers"),
      headers: z.array(z.object({ name: z.string().min(1), value: z.string().min(1) })),
    }),
    z.object({ type: z.literal("unchanged") }),
  ]),
  enabled: z.boolean(),
  enabledTools: z.array(z.string()).nullable(),
  description: z.string().max(500).optional(),
});

export const McpServerSaveInputArraySchema = z.array(McpServerSaveInputSchema);
