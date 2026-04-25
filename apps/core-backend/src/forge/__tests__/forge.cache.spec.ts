import { ForgeCache } from "../forge.cache";

describe("ForgeCache", () => {
  it("returns a cached value within TTL and re-fetches after expiry", async () => {
    const cache = new ForgeCache({ ttlMs: 50, max: 100 });
    const loader = jest.fn().mockResolvedValueOnce("A").mockResolvedValueOnce("B");

    const a = await cache.getOrLoad("k", loader);
    const b = await cache.getOrLoad("k", loader);
    expect(a).toBe("A");
    expect(b).toBe("A");
    expect(loader).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 70));
    const c = await cache.getOrLoad("k", loader);
    expect(c).toBe("B");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("invalidates a whole user:instance prefix via invalidate()", async () => {
    const cache = new ForgeCache({ ttlMs: 5_000, max: 100 });
    await cache.getOrLoad("u1:i1:counts", async () => 1);
    await cache.getOrLoad("u1:i1:my-prs:first", async () => 2);
    await cache.getOrLoad("u2:i1:counts", async () => 3);

    cache.invalidatePrefix("u1:i1:");

    const after1 = await cache.getOrLoad("u1:i1:counts", async () => 99);
    const after2 = await cache.getOrLoad("u2:i1:counts", async () => 99);
    expect(after1).toBe(99);
    expect(after2).toBe(3);
  });

  it("keys include userId so users do not see each other's cached results", async () => {
    const cache = new ForgeCache({ ttlMs: 5_000, max: 100 });
    await cache.getOrLoad("userA:i1:counts", async () => "A-counts");
    const other = await cache.getOrLoad("userB:i1:counts", async () => "B-counts");
    expect(other).toBe("B-counts");
  });
});
