import { PrismaService } from "../../prisma/prisma.service";
import { createGetNoteTool } from "./get-note.tool";

function makePrisma(document: unknown = null) {
  return {
    document: {
      findFirst: jest.fn().mockResolvedValue(document),
    },
  } as unknown as PrismaService;
}

describe("createGetNoteTool", () => {
  const userId = "user-1";

  it("returns a tool with name 'get_note'", () => {
    const t = createGetNoteTool(makePrisma(), userId);
    expect(t.name).toBe("get_note");
  });

  it("calls prisma.document.findFirst with documentId, userId, and deleted=false", async () => {
    const prisma = makePrisma();
    const t = createGetNoteTool(prisma, userId);

    await t.invoke({ documentId: "doc-1" });

    expect(prisma.document.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "doc-1",
          userId,
          deleted: false,
        },
        select: expect.any(Object),
      }),
    );
  });

  it("returns JSON-stringified document when found", async () => {
    const doc = {
      id: "doc-1",
      title: "My Note",
      markdown: "# Hello\n\nContent here.",
      path: "/my-note",
    };
    const t = createGetNoteTool(makePrisma(doc), userId);

    const result = await t.invoke({ documentId: "doc-1" });
    const parsed = JSON.parse(result as string);

    expect(parsed.id).toBe("doc-1");
    expect(parsed.title).toBe("My Note");
    expect(parsed.markdown).toBe("# Hello\n\nContent here.");
  });

  it("serializes BigInt serverSeq without throwing", async () => {
    const doc = {
      id: "doc-1",
      userId,
      title: "T",
      path: "p.md",
      markdown: "x",
      plainText: "x",
      deleted: false,
      embedded: false,
      serverSeq: BigInt(42),
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-02T00:00:00.000Z"),
    };
    const t = createGetNoteTool(makePrisma(doc), userId);

    const result = await t.invoke({ documentId: "doc-1" });
    const parsed = JSON.parse(result as string);

    expect(parsed.serverSeq).toBe("42");
  });

  it("returns { error: 'Note not found' } when document is not found", async () => {
    const t = createGetNoteTool(makePrisma(null), userId);

    const result = await t.invoke({ documentId: "nonexistent" });
    const parsed = JSON.parse(result as string);

    expect(parsed).toEqual({ error: "Note not found" });
  });

  it("uses the correct userId when querying", async () => {
    const prisma = makePrisma();
    const t = createGetNoteTool(prisma, "specific-user-id");

    await t.invoke({ documentId: "doc-2" });

    expect(prisma.document.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "specific-user-id" }),
      }),
    );
  });

  it("does not return deleted documents", async () => {
    const prisma = makePrisma();
    const t = createGetNoteTool(prisma, userId);

    await t.invoke({ documentId: "deleted-doc" });

    expect(prisma.document.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deleted: false }),
      }),
    );
  });
});
