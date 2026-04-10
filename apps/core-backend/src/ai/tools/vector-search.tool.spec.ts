import type { PrismaClient } from "@slate/server-db";
import { Embeddings } from "@langchain/core/embeddings";
import { padEmbeddingToMax } from "../embedding-dimensions";
import { createVectorSearchTool } from "./vector-search.tool";

function makePrisma(rows: unknown[] = []) {
  return {
    $queryRaw: jest.fn().mockResolvedValue(rows),
  } as unknown as PrismaClient;
}

function makeEmbeddings(vector: number[] = [0.1, 0.2, 0.3]) {
  return {
    embedQuery: jest.fn().mockResolvedValue(vector),
  } as unknown as Embeddings;
}

describe("createVectorSearchTool", () => {
  const userId = "user-1";
  const embeddingModelId = "text-embedding-3-small";

  it("returns a tool with name 'vector_search'", () => {
    const t = createVectorSearchTool(makePrisma(), makeEmbeddings(), userId, embeddingModelId);
    expect(t.name).toBe("vector_search");
  });

  it("embeds the query using embeddings.embedQuery", async () => {
    const embeddings = makeEmbeddings();
    const t = createVectorSearchTool(makePrisma(), embeddings, userId, embeddingModelId);

    await t.invoke({ query: "test query", limit: null });

    expect(embeddings.embedQuery).toHaveBeenCalledWith("test query");
  });

  it("accepts LangGraph tool-call wrapper shape (unwraps args)", async () => {
    const embeddings = makeEmbeddings();
    const t = createVectorSearchTool(makePrisma(), embeddings, userId, embeddingModelId);

    await t.invoke({
      name: "vector_search",
      type: "tool_call",
      id: "call-1",
      args: { query: "Drivnbye project situation" },
    } as any);

    expect(embeddings.embedQuery).toHaveBeenCalledWith("Drivnbye project situation");
  });

  it("accepts wrapper with args omitting limit (defaults to 5)", async () => {
    const prisma = makePrisma();
    const t = createVectorSearchTool(prisma, makeEmbeddings(), userId, embeddingModelId);

    await t.invoke({
      name: "vector_search",
      args: { query: "x" },
    } as any);

    // Tagged template: mock.calls[0] = [strings, vectorExpr, vectorExpr, userId, embeddingModelId, limit]
    const callArgs = (prisma.$queryRaw as jest.Mock).mock.calls[0];
    expect(callArgs).toContainEqual(5);
  });

  it("calls $queryRaw with userId, embeddingModelId, and limit", async () => {
    const prisma = makePrisma();
    const t = createVectorSearchTool(prisma, makeEmbeddings(), userId, embeddingModelId);

    await t.invoke({ query: "test", limit: 3 });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    // Tagged template: mock.calls[0] = [strings, vectorExpr, vectorExpr, userId, embeddingModelId, limit]
    const callArgs = (prisma.$queryRaw as jest.Mock).mock.calls[0];
    expect(callArgs).toContainEqual(userId);
    expect(callArgs).toContainEqual(embeddingModelId);
    expect(callArgs).toContainEqual(3);
  });

  it("uses default limit of 5 when not provided", async () => {
    const prisma = makePrisma();
    const t = createVectorSearchTool(prisma, makeEmbeddings(), userId, embeddingModelId);

    await t.invoke({ query: "test", limit: null });

    // Tagged template: mock.calls[0] = [strings, vectorExpr, vectorExpr, userId, embeddingModelId, limit]
    const callArgs = (prisma.$queryRaw as jest.Mock).mock.calls[0];
    expect(callArgs).toContainEqual(5);
  });

  it("returns JSON-stringified array of result objects", async () => {
    const rows = [
      {
        id: "chunk-1",
        content: "some content",
        heading: "Section A",
        documentId: "doc-1",
        title: "My Note",
        path: "/my-note",
        similarity: 0.95,
      },
    ];
    const t = createVectorSearchTool(makePrisma(rows), makeEmbeddings(), userId, embeddingModelId);

    const result = await t.invoke({ query: "test", limit: null });
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      content: "some content",
      heading: "Section A",
      documentId: "doc-1",
      documentTitle: "My Note",
      documentPath: "/my-note",
      similarity: 0.95,
    });
  });

  it("maps raw row fields to the expected output shape", async () => {
    const rows = [
      {
        id: "chunk-2",
        content: "chunk content",
        heading: null,
        documentId: "doc-2",
        title: "Doc Title",
        path: "/docs/title",
        similarity: 0.8,
      },
    ];
    const t = createVectorSearchTool(makePrisma(rows), makeEmbeddings(), userId, embeddingModelId);

    const result = await t.invoke({ query: "anything", limit: null });
    const parsed = JSON.parse(result as string);

    expect(parsed[0].documentTitle).toBe("Doc Title");
    expect(parsed[0].documentPath).toBe("/docs/title");
    expect(parsed[0].heading).toBeNull();
  });

  it("returns an empty array when no results are found", async () => {
    const t = createVectorSearchTool(makePrisma([]), makeEmbeddings(), userId, embeddingModelId);

    const result = await t.invoke({ query: "unknown", limit: null });
    const parsed = JSON.parse(result as string);

    expect(parsed).toEqual([]);
  });

  it("includes padded vector(4096) literal in the SQL text", async () => {
    const prisma = makePrisma();
    const embeddings = makeEmbeddings([0.5, 0.6, 0.7]);
    const t = createVectorSearchTool(prisma, embeddings, userId, embeddingModelId);

    await t.invoke({ query: "test", limit: null });

    // Tagged template: [strings, vectorExpr, vectorExpr, userId, embeddingModelId, limit]
    const callArgs = (prisma.$queryRaw as jest.Mock).mock.calls[0];
    const serialized = JSON.stringify(callArgs);
    expect(serialized).toContain("vector(4096)");
    expect(serialized).toContain("embeddingModel");
    const paddedLiteral = `[${padEmbeddingToMax([0.5, 0.6, 0.7]).join(",")}]`;
    expect(serialized).toContain(paddedLiteral);
  });
});
