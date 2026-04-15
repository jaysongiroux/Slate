import type { PrismaClient } from "@slate/server-db";

export interface ContactCacheEntry {
  email: string;
  displayName?: string | null;
  photoUrl?: string | null;
}

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class ContactCacheService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Look up cached entries for a list of emails. Returns a Map keyed by email. */
  async lookup(
    userId: string,
    emails: string[],
  ): Promise<Map<string, { displayName: string | null; photoUrl: string | null }>> {
    if (emails.length === 0) return new Map();

    const rows = await this.prisma.contactCache.findMany({
      where: { userId, email: { in: emails } },
    });

    const result = new Map<string, { displayName: string | null; photoUrl: string | null }>();
    for (const row of rows) {
      result.set(row.email, { displayName: row.displayName, photoUrl: row.photoUrl });
    }
    return result;
  }

  /** Store (upsert) entries into cache. Pass displayName/photoUrl as undefined to store null (negative cache). */
  async store(userId: string, entries: ContactCacheEntry[]): Promise<void> {
    if (entries.length === 0) return;

    await Promise.all(
      entries.map((entry) =>
        this.prisma.contactCache.upsert({
          where: {
            userId_email: {
              userId,
              email: entry.email.trim().toLowerCase(),
            },
          },
          update: {
            displayName: entry.displayName ?? null,
            photoUrl: entry.photoUrl ?? null,
          },
          create: {
            userId,
            email: entry.email.trim().toLowerCase(),
            displayName: entry.displayName ?? null,
            photoUrl: entry.photoUrl ?? null,
          },
        }),
      ),
    );
  }

  /** Delete all cache entries for a user. */
  async flush(userId: string): Promise<void> {
    await this.prisma.contactCache.deleteMany({ where: { userId } });
  }

  /** Delete entries older than 30 days. Call from a daily cron/interval. */
  async gc(): Promise<void> {
    const cutoff = new Date(Date.now() - TTL_MS);
    await this.prisma.contactCache.deleteMany({
      where: { updatedAt: { lt: cutoff } },
    });
  }
}
