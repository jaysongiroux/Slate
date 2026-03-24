import { PrismaService } from "../prisma/prisma.service";
import { ModelProviderService } from "./model-provider.service";
import { ChunkingService } from "./chunking.service";
import { EmbeddingService } from "./embedding.service";

function makePrisma() {
  return {
    documentChunk: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    document: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    aiConfig: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  } as unknown as PrismaService;
}

function makeModelProvider(vectors: number[][] = [[0.1, 0.2, 0.3]]) {
  return {
    getEmbeddingModel: jest.fn().mockResolvedValue({
      embedDocuments: jest.fn().mockResolvedValue(vectors),
    }),
  } as unknown as ModelProviderService;
}

function makeChunking(chunks = [{ chunkIndex: 0, content: "Hello world", heading: null }]) {
  return {
    chunkMarkdown: jest.fn().mockReturnValue(chunks),
  } as unknown as ChunkingService;
}

describe("EmbeddingService", () => {
  let service: EmbeddingService;
  let prisma: ReturnType<typeof makePrisma>;
  let modelProvider: ReturnType<typeof makeModelProvider>;
  let chunking: ReturnType<typeof makeChunking>;

  beforeEach(() => {
    prisma = makePrisma();
    modelProvider = makeModelProvider();
    chunking = makeChunking();
    service = new EmbeddingService(
      prisma as unknown as PrismaService,
      modelProvider as unknown as ModelProviderService,
      chunking as unknown as ChunkingService,
    );
  });

  describe("embedDocument", () => {
    it("chunks the markdown using ChunkingService", async () => {
      const doc = { id: "doc-1", userId: "user-1", markdown: "# Hello\n\nWorld", title: "Hello" };

      await service.embedDocument(doc, "text-embedding-ada-002");

      expect(chunking.chunkMarkdown).toHaveBeenCalledWith(doc.markdown);
    });

    it("deletes existing DocumentChunks for the document before inserting", async () => {
      const doc = { id: "doc-1", userId: "user-1", markdown: "# Hello\n\nWorld", title: "Hello" };

      await service.embedDocument(doc, "text-embedding-ada-002");

      expect(prisma.documentChunk.deleteMany).toHaveBeenCalledWith({
        where: { documentId: "doc-1" },
      });
    });

    it("calls getEmbeddingModel with the document userId", async () => {
      const doc = { id: "doc-1", userId: "user-1", markdown: "# Hello\n\nWorld", title: "Hello" };

      await service.embedDocument(doc, "text-embedding-ada-002");

      expect(modelProvider.getEmbeddingModel).toHaveBeenCalledWith("user-1");
    });

    it("calls embedDocuments with chunk contents", async () => {
      const chunks = [
        { chunkIndex: 0, content: "chunk one", heading: null },
        { chunkIndex: 1, content: "chunk two", heading: "Section" },
      ];
      const vectors = [[0.1, 0.2], [0.3, 0.4]];
      const mockEmbedder = { embedDocuments: jest.fn().mockResolvedValue(vectors) };
      (modelProvider.getEmbeddingModel as jest.Mock).mockResolvedValue(mockEmbedder);
      (chunking.chunkMarkdown as jest.Mock).mockReturnValue(chunks);

      const doc = { id: "doc-1", userId: "user-1", markdown: "some long markdown", title: "Doc" };
      await service.embedDocument(doc, "text-embedding-ada-002");

      expect(mockEmbedder.embedDocuments).toHaveBeenCalledWith(["chunk one", "chunk two"]);
    });

    it("inserts each chunk via $executeRaw with the vector string", async () => {
      const chunks = [
        { chunkIndex: 0, content: "chunk one", heading: null },
        { chunkIndex: 1, content: "chunk two", heading: "Section" },
      ];
      const vectors = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]];
      const mockEmbedder = { embedDocuments: jest.fn().mockResolvedValue(vectors) };
      (modelProvider.getEmbeddingModel as jest.Mock).mockResolvedValue(mockEmbedder);
      (chunking.chunkMarkdown as jest.Mock).mockReturnValue(chunks);

      const doc = { id: "doc-1", userId: "user-1", markdown: "some long markdown", title: "Doc" };
      await service.embedDocument(doc, "text-embedding-ada-002");

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it("marks the document as embedded after storing chunks", async () => {
      const doc = { id: "doc-1", userId: "user-1", markdown: "# Hello\n\nWorld", title: "Hello" };

      await service.embedDocument(doc, "text-embedding-ada-002");

      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: "doc-1" },
        data: { embedded: true },
      });
    });

    it("sets embedded=true after all inserts complete", async () => {
      const callOrder: string[] = [];
      (prisma.$executeRaw as jest.Mock).mockImplementation(async () => {
        callOrder.push("$executeRaw");
        return 1;
      });
      (prisma.document.update as jest.Mock).mockImplementation(async () => {
        callOrder.push("document.update");
        return {};
      });

      const doc = { id: "doc-1", userId: "user-1", markdown: "# Hello", title: "Hello" };
      await service.embedDocument(doc, "text-embedding-ada-002");

      const insertIdx = callOrder.indexOf("$executeRaw");
      const updateIdx = callOrder.indexOf("document.update");
      expect(insertIdx).toBeLessThan(updateIdx);
    });

    it("handles a document that produces multiple chunks", async () => {
      const chunks = Array.from({ length: 5 }, (_, i) => ({
        chunkIndex: i,
        content: `chunk ${i}`,
        heading: i === 0 ? null : `Section ${i}`,
      }));
      const vectors = chunks.map((_, i) => [i * 0.1, i * 0.2]);
      const mockEmbedder = { embedDocuments: jest.fn().mockResolvedValue(vectors) };
      (modelProvider.getEmbeddingModel as jest.Mock).mockResolvedValue(mockEmbedder);
      (chunking.chunkMarkdown as jest.Mock).mockReturnValue(chunks);

      const doc = { id: "doc-2", userId: "user-1", markdown: "long doc", title: "Long Doc" };
      await service.embedDocument(doc, "text-embedding-3-small");

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(5);
      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: "doc-2" },
        data: { embedded: true },
      });
    });
  });

  describe("processUnembeddedDocuments", () => {
    it("does nothing when no users have embedding configured", async () => {
      (prisma.aiConfig.findMany as jest.Mock).mockResolvedValue([]);

      await service.processUnembeddedDocuments();

      expect(prisma.document.findMany).not.toHaveBeenCalled();
    });

    it("queries for unembedded documents for users with embedding config", async () => {
      (prisma.aiConfig.findMany as jest.Mock).mockResolvedValue([
        { userId: "user-1", embeddingModel: "text-embedding-ada-002" },
      ]);
      (prisma.document.findMany as jest.Mock).mockResolvedValue([]);

      await service.processUnembeddedDocuments();

      expect(prisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: { in: ["user-1"] },
            embedded: false,
            deleted: false,
          }),
        }),
      );
    });

    it("respects the batchSize parameter", async () => {
      (prisma.aiConfig.findMany as jest.Mock).mockResolvedValue([
        { userId: "user-1", embeddingModel: "text-embedding-ada-002" },
      ]);
      (prisma.document.findMany as jest.Mock).mockResolvedValue([]);

      await service.processUnembeddedDocuments(10);

      expect(prisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it("processes each document and embeds it", async () => {
      (prisma.aiConfig.findMany as jest.Mock).mockResolvedValue([
        { userId: "user-1", embeddingModel: "text-embedding-ada-002" },
      ]);
      (prisma.document.findMany as jest.Mock).mockResolvedValue([
        { id: "doc-1", userId: "user-1", markdown: "# Hello", title: "Hello" },
        { id: "doc-2", userId: "user-1", markdown: "# World", title: "World" },
      ]);

      await service.processUnembeddedDocuments();

      // Each document should be marked as embedded
      expect(prisma.document.update).toHaveBeenCalledTimes(2);
    });

    it("continues processing remaining documents when one fails", async () => {
      (prisma.aiConfig.findMany as jest.Mock).mockResolvedValue([
        { userId: "user-1", embeddingModel: "text-embedding-ada-002" },
      ]);
      (prisma.document.findMany as jest.Mock).mockResolvedValue([
        { id: "doc-fail", userId: "user-1", markdown: "# Fail", title: "Fail" },
        { id: "doc-ok", userId: "user-1", markdown: "# OK", title: "OK" },
      ]);

      // Fail on first doc, succeed on second
      (modelProvider.getEmbeddingModel as jest.Mock)
        .mockRejectedValueOnce(new Error("API error"))
        .mockResolvedValueOnce({ embedDocuments: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]) });

      await expect(service.processUnembeddedDocuments()).resolves.not.toThrow();

      // Second document should still be processed (document.update called once for the successful one)
      expect(prisma.document.update).toHaveBeenCalledTimes(1);
      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: "doc-ok" },
        data: { embedded: true },
      });
    });
  });
});
