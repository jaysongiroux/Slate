import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { PrismaService } from "../../prisma/prisma.service";

export function createTitleSearchTool(prisma: PrismaService, userId: string) {
  return (tool as any)(
    async ({ query }: { query: string }) => {
      const documents = await prisma.document.findMany({
        where: {
          userId,
          deleted: false,
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { path: { contains: query, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          title: true,
          path: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
      });

      return JSON.stringify(documents);
    },
    {
      name: "title_search",
      description:
        "Searches notes by title or path using a case-insensitive text match. Use this when the user is looking for a specific note by name or file path.",
      schema: z.object({
        query: z.string().describe("The text to search for in note titles and paths"),
      }),
    },
  );
}
