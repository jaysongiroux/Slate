import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Prisma } from "@slate/server-db";
import { PrismaService } from "../../prisma/prisma.service";

/** Min length for "title/path appears inside the search phrase" matching (reduces junk hits). */
const MIN_SUBSTRING_LEN = 3;

/**
 * Trim and strip common wrapping quotes from model output (e.g. `"About me"`).
 */
export function normalizeTitleSearchQuery(raw: string): string {
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  const curlyOpen = "\u201c";
  const curlyClose = "\u201d";
  if (s.startsWith(curlyOpen) && s.endsWith(curlyClose)) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/** Escape %, _, \\ for use in ILIKE ... ESCAPE '\\'. */
function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function createTitleSearchTool(prisma: PrismaService, userId: string) {
  return (tool as any)(
    async ({ query: rawQuery }: { query: string }) => {
      const query = normalizeTitleSearchQuery(rawQuery);
      if (!query) {
        return JSON.stringify([]);
      }

      const likePattern = `%${escapeLikePattern(query)}%`;

      const documents = await prisma.$queryRaw<
        Array<{ id: string; title: string; path: string; updatedAt: Date }>
      >(Prisma.sql`
        SELECT id, title, path, "updatedAt"
        FROM document
        WHERE "userId" = ${userId}
          AND deleted = false
          AND (
            title ILIKE ${likePattern} ESCAPE '\\'
            OR path ILIKE ${likePattern} ESCAPE '\\'
            OR (
              length(trim(title)) >= ${MIN_SUBSTRING_LEN}
              AND position(lower(trim(title)) in lower(${query}::text)) > 0
            )
            OR (
              length(trim(path)) >= ${MIN_SUBSTRING_LEN}
              AND position(lower(trim(path)) in lower(${query}::text)) > 0
            )
          )
        ORDER BY "updatedAt" DESC
        LIMIT 10
      `);

      return JSON.stringify(documents);
    },
    {
      name: "title_search",
      description:
        "Searches notes by title or path (case-insensitive). Matches if the note title/path contains your phrase OR your phrase contains the note title/path — so short note names still match inside longer questions. Prefer a concise name or path fragment when possible.",
      schema: z.object({
        query: z
          .string()
          .describe(
            "Note title, path/filename fragment, or short phrase; e.g. About me or about-me — not required to match the full user message",
          ),
      }),
    },
  );
}
