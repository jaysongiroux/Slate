import { PrismaService } from "../../prisma/prisma.service";
import { createTitleSearchTool } from "./title-search.tool";

function makePrisma(documents: unknown[] = []) {
  return {
    document: {
      findMany: jest.fn().mockResolvedValue(documents),
    },
  } as unknown as PrismaService;
}

describe("createTitleSearchTool", () => {
  const userId = "user-1";

  it("returns a tool with name 'title_search'", () => {
    const t = createTitleSearchTool(makePrisma(), userId);
    expect(t.name).toBe("title_search");
  });

  it("calls prisma.document.findMany with the correct userId filter", async () => {
    const prisma = makePrisma();
    const t = createTitleSearchTool(prisma, userId);

    await t.invoke({ query: "meeting" });

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId }),
      }),
    );
  });

  it("filters out deleted documents", async () => {
    const prisma = makePrisma();
    const t = createTitleSearchTool(prisma, userId);

    await t.invoke({ query: "meeting" });

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deleted: false }),
      }),
    );
  });

  it("searches by title with case-insensitive ILIKE", async () => {
    const prisma = makePrisma();
    const t = createTitleSearchTool(prisma, userId);

    await t.invoke({ query: "meeting" });

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { title: { contains: "meeting", mode: "insensitive" } },
          ]),
        }),
      }),
    );
  });

  it("searches by path with case-insensitive ILIKE", async () => {
    const prisma = makePrisma();
    const t = createTitleSearchTool(prisma, userId);

    await t.invoke({ query: "projects" });

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { path: { contains: "projects", mode: "insensitive" } },
          ]),
        }),
      }),
    );
  });

  it("orders results by updatedAt descending", async () => {
    const prisma = makePrisma();
    const t = createTitleSearchTool(prisma, userId);

    await t.invoke({ query: "test" });

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { updatedAt: "desc" },
      }),
    );
  });

  it("limits results to 10", async () => {
    const prisma = makePrisma();
    const t = createTitleSearchTool(prisma, userId);

    await t.invoke({ query: "test" });

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
  });

  it("returns JSON-stringified array of documents", async () => {
    const docs = [
      { id: "doc-1", title: "Meeting Notes", path: "/meeting-notes", updatedAt: new Date("2024-01-01") },
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
