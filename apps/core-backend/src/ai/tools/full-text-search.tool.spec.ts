import { SearchService } from "../../search/search.service";
import { createFullTextSearchTool } from "./full-text-search.tool";

function makeSearchService(results: unknown[] = []) {
  return {
    search: jest.fn().mockResolvedValue({ results }),
  } as unknown as SearchService;
}

describe("createFullTextSearchTool", () => {
  const userId = "user-1";

  it("returns a tool with name 'full_text_search'", () => {
    const t = createFullTextSearchTool(makeSearchService(), userId);
    expect(t.name).toBe("full_text_search");
  });

  it("calls searchService.search with userId, query, and limit 10", async () => {
    const searchService = makeSearchService();
    const t = createFullTextSearchTool(searchService, userId);

    await t.invoke({ query: "project meeting" });

    expect(searchService.search).toHaveBeenCalledWith(userId, "project meeting", 10);
  });

  it("returns JSON-stringified results array", async () => {
    const results = [
      {
        documentId: "doc-1",
        title: "Meeting Notes",
        snippet: "...discussed the project...",
        path: "/meeting-notes",
        rank: 0.9,
      },
    ];
    const t = createFullTextSearchTool(makeSearchService(results), userId);

    const result = await t.invoke({ query: "meeting" });
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].documentId).toBe("doc-1");
    expect(parsed[0].title).toBe("Meeting Notes");
    expect(parsed[0].snippet).toBe("...discussed the project...");
    expect(parsed[0].rank).toBe(0.9);
  });

  it("destructures results from the SearchService response", async () => {
    const searchService = makeSearchService([{ documentId: "doc-1", title: "Test" }]);
    const t = createFullTextSearchTool(searchService, userId);

    const result = await t.invoke({ query: "test" });
    // Should contain the results array, not the wrapper object
    const parsed = JSON.parse(result as string);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].documentId).toBe("doc-1");
  });

  it("returns an empty array when no results are found", async () => {
    const t = createFullTextSearchTool(makeSearchService([]), userId);

    const result = await t.invoke({ query: "nonexistent term" });
    const parsed = JSON.parse(result as string);

    expect(parsed).toEqual([]);
  });

  it("uses the correct userId when calling search", async () => {
    const searchService = makeSearchService();
    const t = createFullTextSearchTool(searchService, "specific-user-id");

    await t.invoke({ query: "test" });

    expect(searchService.search).toHaveBeenCalledWith("specific-user-id", "test", 10);
  });

  it("returns multiple results when found", async () => {
    const results = [
      { documentId: "doc-1", title: "Note A", snippet: "snippet a", path: "/a", rank: 0.9 },
      { documentId: "doc-2", title: "Note B", snippet: "snippet b", path: "/b", rank: 0.7 },
      { documentId: "doc-3", title: "Note C", snippet: "snippet c", path: "/c", rank: 0.5 },
    ];
    const t = createFullTextSearchTool(makeSearchService(results), userId);

    const result = await t.invoke({ query: "note" });
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveLength(3);
    expect(parsed[1].documentId).toBe("doc-2");
  });
});
