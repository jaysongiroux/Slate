import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { PrismaService } from "../../prisma/prisma.service";

export function createListRecentTool(prisma: PrismaService, userId: string) {
  return (tool as any)(
    async (input: { limit: number | null; sort: "createdAt" | "updatedAt" | null }) => {
      const limit = input.limit ?? 10;
      const sort = input.sort ?? "updatedAt";
      const documents = await prisma.document.findMany({
        where: {
          userId,
          deleted: false,
        },
        select: {
          id: true,
          title: true,
          path: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { [sort]: "desc" },
        take: limit,
      });

      return JSON.stringify(documents);
    },
    {
      name: "list_recent",
      description:
        "Lists the most recently created or updated notes. Use this to get an overview of recent activity or when the user asks about recent notes.",
      schema: z.object({
        limit: z.number().nullable().describe("Maximum number of notes to return (default: 10)"),
        sort: z
          .enum(["createdAt", "updatedAt"])
          .nullable()
          .describe("Sort by creation date or last update date (default: updatedAt)"),
      }),
    },
  );
}
