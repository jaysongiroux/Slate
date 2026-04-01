import { PrismaService } from "../../prisma/prisma.service";
import { createTitleSearchTool, normalizeTitleSearchQuery } from "./title-search.tool";

function makePrisma(rows: unknown[] = []) {
  return {
    $queryRaw: jest.fn().mockResolvedValue(rows),
  } as unknown as PrismaService;
}

describe("normalizeTitleSearchQuery", () => {
  it("trims whitespace", () => {
    expect(normalizeTitleSearchQuery("  foo  ")).toBe("foo");
  });

  it("strips ASCII double quotes", () => {
    expect(normalizeTitleSearchQuery('"About me"')).toBe("About me");
  });

  it("strips curly quotes", () => {
    expect(normalizeTitleSearchQuery("\u201cAbout me\u201d")).toBe("About me");
  });
});

describe("createTitleSearchTool", () => {
  const userId = "user-1";

  it("returns a tool with name 'title_search'", () => {
    const t = createTitleSearchTool(makePrisma(), userId);
    expect(t.name).toBe("title_search");
  });

  it("calls prisma.$queryRaw once with a bounded query", async () => {
    const prisma = makePrisma();
    const t = createTitleSearchTool(prisma, userId);

    await t.invoke({ query: "meeting" });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("does not query when input is empty after normalization", async () => {
    const prisma = makePrisma();
    const t = createTitleSearchTool(prisma, userId);

    const r = await t.invoke({ query: "   " });
    expect(JSON.parse(r as string)).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("returns JSON-stringified array of documents", async () => {
    const docs = [
      {
        id: "doc-1",
        title: "Meeting Notes",
        path: "meeting-notes.md",
        updatedAt: new Date("2024-01-01"),
      },
    ];
    const t = createTitleSearchTool(makePrisma(docs), userId);

    const result = await t.invoke({ query: "meeting" });
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("doc-1");
    expect(parsed[0].title).toBe("Meeting Notes");
  });

  it("returns an empty array when no documents match", async () => {
    const t = createTitleSearchTool(makePrisma([]), userId);

    const result = await t.invoke({ query: "nonexistent" });
    const parsed = JSON.parse(result as string);

    expect(parsed).toEqual([]);
  });
});
