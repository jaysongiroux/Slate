import { tool } from "@langchain/core/tools";
import { Embeddings } from "@langchain/core/embeddings";
import { z } from "zod";
import { PrismaService } from "../../prisma/prisma.service";

interface VectorSearchRow {
  id: string;
  content: string;
  heading: string | null;
  documentId: string;
  title: string;
  path: string;
  similarity: number;
}

export function createVectorSearchTool(
  prisma: PrismaService,
  embeddings: Embeddings,
  userId: string,
) {
  return (tool as any)(
    async ({ query, limit = 5 }: { query: string; limit?: number }) => {
      const vector = await embeddings.embedQuery(query);
      const vectorStr = `[${vector.join(",")}]`;

      const rows = (await prisma.$queryRawUnsafe(
        `SELECT dc.id, dc.content, dc.heading, dc."documentId", d.title, d.path,
          1 - (dc.embedding <=> '${vectorStr}'::vector) as similarity
        FROM document_chunk dc
        JOIN document d ON d.id = dc."documentId"
        WHERE dc."userId" = $1 AND d.deleted = false AND dc.embedding IS NOT NULL
        ORDER BY dc.embedding <=> '${vectorStr}'::vector LIMIT $2`,
        userId,
        limit,
      )) as VectorSearchRow[];

      const results = rows.map((row: VectorSearchRow) => ({
        content: row.content,
        heading: row.heading,
        documentId: row.documentId,
        documentTitle: row.title,
        documentPath: row.path,
        similarity: row.similarity,
      }));

      return JSON.stringify(results);
    },
    {
      name: "vector_search",
      description:
        "Performs a semantic similarity search over note chunks using vector embeddings. Use this to find notes related to a concept or topic by meaning.",
      schema: z.object({
        query: z.string().describe("The search query to embed and compare against stored chunks"),
        limit: z.number().optional().describe("Maximum number of results to return (default: 5)"),
      }),
    },
  );
}
