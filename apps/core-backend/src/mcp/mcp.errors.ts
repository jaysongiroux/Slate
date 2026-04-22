export type McpConnectErrorKind =
  | "unreachable"
  | "auth_failed"
  | "timeout"
  | "bad_response"
  | "misconfigured";

export type McpToolCallErrorKind = "tool_error" | "timeout" | "transport_error";

export class McpConnectError extends Error {
  readonly kind: McpConnectErrorKind;
  constructor(kind: McpConnectErrorKind, message: string) {
    super(message);
    this.name = "McpConnectError";
    this.kind = kind;
  }
}

export class McpToolCallError extends Error {
  readonly kind: McpToolCallErrorKind;
  constructor(kind: McpToolCallErrorKind, message: string) {
    super(message);
    this.name = "McpToolCallError";
    this.kind = kind;
  }
}

export function isMcpConnectError(err: unknown): err is McpConnectError {
  return err instanceof McpConnectError;
}
