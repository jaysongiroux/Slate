import { desktopApi } from "./ipc-core";

export type McpAuthInput =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "headers"; headers: Array<{ name: string; value: string }> }
  | { type: "unchanged" };

export type McpAuthPublic =
  | { type: "none" }
  | { type: "bearer"; hasToken: true }
  | { type: "headers"; headerNames: string[] };

export type McpTransport = "http" | "sse" | "streamable-http";

export interface McpServerSaveInput {
  id?: string;
  name: string;
  url: string;
  transport: McpTransport;
  auth: McpAuthInput;
  enabled: boolean;
  enabledTools: string[] | null;
  description?: string;
}

export interface McpServerPublic {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
  auth: McpAuthPublic;
  enabled: boolean;
  enabledTools: string[] | null;
  description?: string;
  createdAt: string;
  updatedAt: string;
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
  inputSchema: Record<string, unknown>;
}

export const mcpApi = {
  getServers: () => desktopApi().getMcpServers(),
  saveServers: (servers: McpServerSaveInput[]) => desktopApi().putMcpServers(servers),
  testServer: (server: McpServerSaveInput) => desktopApi().testMcpServer(server),
  listServerTools: (serverId: string) => desktopApi().listMcpServerTools(serverId),
  getStatus: () => desktopApi().getMcpStatus(),
};
