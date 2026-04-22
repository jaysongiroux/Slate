export type McpTransport = "http" | "sse" | "streamable-http";

// Stored on disk; secrets are encrypted strings.
export interface McpAuthStored {
  type: "none" | "bearer" | "headers";
  // Bearer: tokenEncrypted; Headers: headersEncrypted
  tokenEncrypted?: string;
  headersEncrypted?: Array<{ name: string; valueEncrypted: string }>;
}

// In-memory after decryption — never sent over the API.
export type McpAuthDecrypted =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "headers"; headers: Array<{ name: string; value: string }> };

// What the API returns — secrets replaced with presence indicators.
export type McpAuthPublic =
  | { type: "none" }
  | { type: "bearer"; hasToken: true }
  | { type: "headers"; headerNames: string[] };

interface McpServerBase {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
  enabled: boolean;
  enabledTools: string[] | null; // null = all enabled
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerStored extends McpServerBase {
  auth: McpAuthStored;
}
export interface McpServerDecrypted extends McpServerBase {
  auth: McpAuthDecrypted;
}
export interface McpServerPublic extends McpServerBase {
  auth: McpAuthPublic;
}

// API input type. `unchanged` lets edits keep the existing secret without re-typing.
export interface McpServerSaveInput {
  id?: string;
  name: string;
  url: string;
  transport: McpTransport;
  auth:
    | { type: "none" }
    | { type: "bearer"; token: string }
    | { type: "headers"; headers: Array<{ name: string; value: string }> }
    | { type: "unchanged" };
  enabled: boolean;
  enabledTools: string[] | null;
  description?: string;
}

export type McpServerStatus =
  | { kind: "ok"; toolCount: number; checkedAt: string }
  | { kind: "unreachable"; error: string; checkedAt: string }
  | { kind: "auth_failed"; error: string; checkedAt: string }
  | { kind: "misconfigured"; error: string; checkedAt: string }
  | { kind: "disabled" };

export interface McpServerStatusPublic {
  id: string;
  name: string;
  status: McpServerStatus;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>; // JSON-Schema object
}
