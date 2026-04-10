import type { PrismaClient } from "@slate/server-db";

export class SearchService {
  constructor(private readonly prisma: PrismaClient) {}

  async search(userId: string, query: string, limit: number) {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; title: string; path: string; snippet: string; rank: number }>
    >`
      SELECT
        id,
        title,
        path,
        ts_headline('english', markdown, plainto_tsquery('english', ${query})) AS snippet,
        ts_rank(to_tsvector('english', coalesce(title, '') || ' ' || coalesce("plainText", '')), plainto_tsquery('english', ${query})) AS rank
      FROM "document"
      WHERE "userId" = ${userId}
        AND deleted = false
        AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce("plainText", '')) @@ plainto_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${limit}
    `;

    return {
      results: rows.map(
        (row: { id: string; title: string; path: string; snippet: string; rank: number }) => ({
          documentId: row.id,
          title: row.title,
          snippet: row.snippet,
          path: row.path,
          rank: row.rank,
        }),
      ),
    };
  }
}
