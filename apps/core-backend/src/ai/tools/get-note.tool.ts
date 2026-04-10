import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { PrismaClient } from "@slate/server-db";

/** Prisma returns BigInt (e.g. serverSeq); plain JSON.stringify throws. */
function jsonStringifyDocumentPayload(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}

const getNoteSelect = {
  id: true,
  userId: true,
  title: true,
  path: true,
  markdown: true,
  plainText: true,
  deleted: true,
  embedded: true,
  serverSeq: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function createGetNoteTool(prisma: PrismaClient, userId: string) {
  return (tool as any)(
    async ({ documentId }: { documentId: string }) => {
      const document = await prisma.document.findFirst({
        where: {
          id: documentId,
          userId,
          deleted: false,
        },
        select: getNoteSelect,
      });

      if (!document) {
        return JSON.stringify({ error: "Note not found" });
      }

      return jsonStringifyDocumentPayload(document);
    },
    {
      name: "get_note",
      description:
        "Retrieves the full content of a specific note by its document ID. Use this after finding a relevant note via search to read its complete contents.",
      schema: z.object({
        documentId: z.string().describe("The unique identifier of the document to retrieve"),
      }),
    },
  );
}
