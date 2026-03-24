import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { PrismaService } from "../../prisma/prisma.service";

export function createGetNoteTool(prisma: PrismaService, userId: string) {
  return (tool as any)(
    async ({ documentId }: { documentId: string }) => {
      const document = await prisma.document.findFirst({
        where: {
          id: documentId,
          userId,
          deleted: false,
        },
      });

      if (!document) {
        return JSON.stringify({ error: "Note not found" });
      }

      return JSON.stringify(document);
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
