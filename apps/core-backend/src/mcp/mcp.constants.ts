export const MCP_SERVERS_SETTING_KEY = "MCP_SERVERS";

// Tool catalog cache (per (userId, serverId))
export const MCP_TOOL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
export const MCP_TOOL_CACHE_MAX = 5000;

// Health cache (per (userId, serverId))
export const MCP_HEALTH_CACHE_TTL_MS = 30 * 1000; // 30 s
export const MCP_HEALTH_CACHE_MAX = 5000;

// Network timeouts
export const MCP_CONNECT_TIMEOUT_MS = 5000;
export const MCP_TOOL_CALL_TIMEOUT_MS = 30_000;

// Validation
export const MCP_NAME_REGEX = /^[a-z0-9_-]{1,32}$/;
export const MCP_TOOL_NAME_SEPARATOR = "__";
