import { PrismaService } from "../../prisma/prisma.service";
import { createListRecentTool } from "./list-recent.tool";

function makePrisma(documents: unknown[] = []) {
  return {
    document: {
      findMany: jest.fn().mockResolvedValue(documents),
    },
  } as unknown as PrismaService;
}

describe("createListRecentTool", () => {
  const userId = "user-1";

  it("returns a tool with name 'list_recent'", () => {
    const t = createListRecentTool(makePrisma(), userId);
    expect(t.name).toBe("list_recent");
  });

  it("calls prisma.document.findMany with userId and deleted=false", async () => {
    const prisma = makePrisma();
    const t = createListRecentTool(prisma, userId);

    await t.invoke({});

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId, deleted: false },
      }),
    );
  });

  it("uses default limit of 10 when not provided", async () => {
    const prisma = makePrisma();
    const t = createListRecentTool(prisma, userId);

    await t.invoke({});

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
  });

  it("respects the limit parameter", async () => {
    const prisma = makePrisma();
    const t = createListRecentTool(prisma, userId);

    await t.invoke({ limit: 5 });

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });

  it("sorts by updatedAt descending by default", async () => {
    const prisma = makePrisma();
    const t = createListRecentTool(prisma, userId);

    await t.invoke({});

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { updatedAt: "desc" },
      }),
    );
  });

  it("sorts by createdAt when sort=createdAt", async () => {
    const prisma = makePrisma();
    const t = createListRecentTool(prisma, userId);

    await t.invoke({ sort: "createdAt" });

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("sorts by updatedAt when sort=updatedAt", async () => {
    const prisma = makePrisma();
    const t = createListRecentTool(prisma, userId);

    await t.invoke({ sort: "updatedAt" });

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { updatedAt: "desc" },
      }),
    );
  });

  it("returns JSON-stringified array of documents", async () => {
    const docs = [
      {
        id: "doc-1",
        title: "Recent Note",
        path: "/recent-note",
        createdAt: new Date("2024-03-01"),
        updatedAt: new Date("2024-03-10"),
      },
    ];
    const t = createListRecentTool(makePrisma(docs), userId);

    const result = await t.invoke({});
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("doc-1");
    expect(parsed[0].title).toBe("Recent Note");
  });

  it("returns an empty array when no documents exist", async () => {
    const t = createListRecentTool(makePrisma([]), userId);

    const result = await t.invoke({});
    const parsed = JSON.parse(result as string);

    expect(parsed).toEqual([]);
  });
});
