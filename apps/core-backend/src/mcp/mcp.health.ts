import { LRUCache } from "lru-cache";
import { MCP_HEALTH_CACHE_TTL_MS, MCP_HEALTH_CACHE_MAX } from "./mcp.constants";
import type { McpServerStatus } from "./mcp.types";

export interface HealthEntry {
  status: McpServerStatus;
  checkedAt: number;
}

function key(userId: string, serverId: string): string {
  return `${userId}:${serverId}`;
}

export class McpHealthCache {
  private cache = new LRUCache<string, HealthEntry>({
    max: MCP_HEALTH_CACHE_MAX,
    ttl: MCP_HEALTH_CACHE_TTL_MS,
    updateAgeOnGet: false,
    allowStale: true,
  });

  get(userId: string, serverId: string): HealthEntry | undefined {
    return this.cache.get(key(userId, serverId));
  }

  set(userId: string, serverId: string, status: McpServerStatus): void {
    this.cache.set(key(userId, serverId), { status, checkedAt: Date.now() });
  }

  invalidate(userId: string, serverId?: string): void {
    if (serverId) {
      this.cache.delete(key(userId, serverId));
      return;
    }
    const prefix = `${userId}:`;
    for (const k of this.cache.keys()) {
      if (k.startsWith(prefix)) this.cache.delete(k);
    }
  }
}
