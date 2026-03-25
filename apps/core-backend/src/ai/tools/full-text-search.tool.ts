import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { SearchService } from "../../search/search.service";

export function createFullTextSearchTool(searchService: SearchService, userId: string) {
  return (tool as any)(
    async ({ query }: { query: string }) => {
      const { results } = await searchService.search(userId, query, 10);
      return JSON.stringify(results);
    },
    {
      name: "full_text_search",
      description:
        "Performs a full-text search over note content using PostgreSQL's text search capabilities. Use this to find notes that contain specific keywords or phrases.",
      schema: z.object({
        query: z.string().describe("The keywords or phrase to search for in note content"),
      }),
    },
  );
}
