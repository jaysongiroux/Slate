import { ContactCacheService } from "./contact-cache.service";

describe("ContactCacheService", () => {
  const TTL_MS = 30 * 24 * 60 * 60 * 1000;

  function makeService(prismaOverrides: Record<string, unknown> = {}) {
    const prisma = {
      contactCache: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      ...prismaOverrides,
    };
    return { prisma, service: new ContactCacheService(prisma as any) };
  }

  describe("lookup", () => {
    it("returns cached entries keyed by email", async () => {
      const { prisma, service } = makeService();
      prisma.contactCache.findMany.mockResolvedValue([
        { email: "alice@example.com", displayName: "Alice", photoUrl: "https://photo/a" },
        { email: "bob@example.com", displayName: null, photoUrl: null },
      ]);

      const result = await service.lookup("user-1", ["alice@example.com", "bob@example.com"]);

      expect(prisma.contactCache.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1", email: { in: ["alice@example.com", "bob@example.com"] } },
      });
      expect(result.get("alice@example.com")).toEqual({
        displayName: "Alice",
        photoUrl: "https://photo/a",
      });
      expect(result.get("bob@example.com")).toEqual({ displayName: null, photoUrl: null });
    });

    it("returns empty map for empty email list", async () => {
      const { prisma, service } = makeService();
      const result = await service.lookup("user-1", []);
      expect(prisma.contactCache.findMany).not.toHaveBeenCalled();
      expect(result.size).toBe(0);
    });
  });

  describe("store", () => {
    it("upserts each entry", async () => {
      const { prisma, service } = makeService();

      await service.store("user-1", [
        { email: "alice@example.com", displayName: "Alice", photoUrl: "https://photo/a" },
        { email: "nobody@example.com", displayName: undefined, photoUrl: undefined },
      ]);

      expect(prisma.contactCache.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.contactCache.upsert).toHaveBeenCalledWith({
        where: { userId_email: { userId: "user-1", email: "alice@example.com" } },
        update: { displayName: "Alice", photoUrl: "https://photo/a" },
        create: {
          userId: "user-1",
          email: "alice@example.com",
          displayName: "Alice",
          photoUrl: "https://photo/a",
        },
      });
      expect(prisma.contactCache.upsert).toHaveBeenCalledWith({
        where: { userId_email: { userId: "user-1", email: "nobody@example.com" } },
        update: { displayName: null, photoUrl: null },
        create: {
          userId: "user-1",
          email: "nobody@example.com",
          displayName: null,
          photoUrl: null,
        },
      });
    });

    it("skips store for empty entries array", async () => {
      const { prisma, service } = makeService();
      await service.store("user-1", []);
      expect(prisma.contactCache.upsert).not.toHaveBeenCalled();
    });
  });

  describe("flush", () => {
    it("deletes all cache entries for a user", async () => {
      const { prisma, service } = makeService();
      await service.flush("user-1");
      expect(prisma.contactCache.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
      });
    });
  });

  describe("gc", () => {
    it("deletes entries older than 30 days", async () => {
      const { prisma, service } = makeService();
      const before = Date.now();
      await service.gc();
      const after = Date.now();

      expect(prisma.contactCache.deleteMany).toHaveBeenCalledTimes(1);
      const call = prisma.contactCache.deleteMany.mock.calls[0][0];
      const cutoff = call.where.updatedAt.lt as Date;
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - TTL_MS);
      expect(cutoff.getTime()).toBeLessThanOrEqual(after - TTL_MS);
    });
  });
});
