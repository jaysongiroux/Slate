import { tool } from "@langchain/core/tools";
import { Embeddings } from "@langchain/core/embeddings";
import { z } from "zod";
import { Prisma } from "@slate/server-db";
import { PrismaService } from "../../prisma/prisma.service";
import { EMBEDDING_VECTOR_DIMENSIONS, padEmbeddingToMax } from "../embedding-dimensions";

interface VectorSearchRow {
  id: string;
  content: string;
  heading: string | null;
  documentId: string;
  title: string;
  path: string;
  similarity: number;
}

/**
 * Query vector is built only from numeric embed outputs (no user text) — safe as Prisma.raw.
 */
export function createVectorSearchTool(
  prisma: PrismaService,
  embeddings: Embeddings,
  userId: string,
  embeddingModelId: string,
) {
  const inputSchema = z.preprocess(
    (raw) => {
      if (raw != null && typeof raw === "object" && !Array.isArray(raw) && "args" in raw) {
        const inner = (raw as { args: unknown }).args;
        if (inner != null && typeof inner === "object" && !Array.isArray(inner)) {
          return inner;
        }
      }
      return raw;
    },
    z.object({
      query: z.string().describe("The search query to embed and compare against stored chunks"),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .nullable()
        .optional()
        .describe("Maximum number of results to return (default: 5)"),
    }),
  );

  return (tool as any)(
    async (input: { query: string; limit?: number | null }) => {
      const { query } = input;
      const limit = input.limit ?? 5;
      const vector = await embeddings.embedQuery(query);
      const padded = padEmbeddingToMax(vector);
      const vectorLiteral = `[${padded.join(",")}]`;
      const vectorExpr = Prisma.raw(`'${vectorLiteral}'::vector(${EMBEDDING_VECTOR_DIMENSIONS})`);

      const rows = (await prisma.$queryRaw(
        Prisma.sql`
        SELECT dc.id, dc.content, dc.heading, dc."documentId", d.title, d.path,
          1 - (dc.embedding <=> ${vectorExpr}) as similarity
        FROM document_chunk dc
        JOIN document d ON d.id = dc."documentId"
        WHERE dc."userId" = ${userId}
          AND d.deleted = false
          AND dc.embedding IS NOT NULL
          AND dc."embeddingModel" = ${embeddingModelId}
        ORDER BY dc.embedding <=> ${vectorExpr}
        LIMIT ${limit}
      `,
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
      schema: inputSchema,
    },
  );
}
