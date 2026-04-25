import { LRUCache } from "lru-cache";

export interface ForgeCacheOptions {
  ttlMs: number;
  max: number;
}

/**
 * Thin LRU wrapper used by ForgeService to cache provider responses.
 * Keys are opaque — callers encode userId / instanceId / kind / cursor.
 */
export class ForgeCache {
  private readonly lru: LRUCache<string, object>;

  constructor(opts: ForgeCacheOptions = { ttlMs: 90_000, max: 5_000 }) {
    this.lru = new LRUCache<string, object>({ max: opts.max, ttl: opts.ttlMs });
  }

  async getOrLoad<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.lru.get(key);
    if (hit !== undefined) return hit as T;
    const value = await load();
    this.lru.set(key, value as unknown as object);
    return value;
  }

  set(key: string, value: unknown, ttlMs?: number): void {
    if (ttlMs != null) this.lru.set(key, value as object, { ttl: ttlMs });
    else this.lru.set(key, value as object);
  }

  invalidate(key: string): void {
    this.lru.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.lru.keys()) {
      if (key.startsWith(prefix)) this.lru.delete(key);
    }
  }

  clear(): void {
    this.lru.clear();
  }
}
