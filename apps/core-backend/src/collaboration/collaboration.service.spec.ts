import { Test, TestingModule } from "@nestjs/testing";
import { CollaborationService } from "./collaboration.service";
import { PrismaService } from "../prisma/prisma.service";
import * as Y from "yjs";

describe("CollaborationService", () => {
  let service: CollaborationService;
  let prisma: { document: { findFirst: jest.Mock; upsert: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      document: {
        findFirst: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CollaborationService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(CollaborationService);
  });

  describe("handleLoadDocument", () => {
    it("applies existing crdtState to the Y.Doc", async () => {
      const source = new Y.Doc();
      source.getXmlFragment("default").insert(0, [new Y.XmlText("hello")]);
      const state = Buffer.from(Y.encodeStateAsUpdate(source));

      prisma.document.findFirst.mockResolvedValue({
        id: "doc1",
        crdtState: state,
      });

      const doc = new Y.Doc();
      await service.handleLoadDocument(doc, "doc1", "user1");

      const text = doc.getXmlFragment("default").toString();
      expect(text).toContain("hello");
      expect(prisma.document.findFirst).toHaveBeenCalledWith({
        where: { id: "doc1", userId: "user1" },
        select: { crdtState: true },
      });
    });

    it("returns empty Y.Doc when no document exists", async () => {
      prisma.document.findFirst.mockResolvedValue(null);

      const doc = new Y.Doc();
      await service.handleLoadDocument(doc, "doc1", "user1");

      expect(doc.getXmlFragment("default").length).toBe(0);
    });
  });

  describe("handleStoreDocument", () => {
    it("persists crdtState and materialized markdown", async () => {
      const ydoc = new Y.Doc();
      prisma.document.upsert.mockResolvedValue({});

      await service.handleStoreDocument(ydoc, "doc1", "user1", "notes/test.md");

      expect(prisma.document.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_path: { userId: "user1", path: "notes/test.md" } },
          update: expect.objectContaining({
            crdtState: expect.any(Buffer),
            markdown: expect.any(String),
          }),
          create: expect.objectContaining({
            id: "doc1",
            userId: "user1",
            path: "notes/test.md",
            crdtState: expect.any(Buffer),
            markdown: expect.any(String),
          }),
        }),
      );
    });
  });
});
