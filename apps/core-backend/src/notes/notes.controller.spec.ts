import { Test, TestingModule } from "@nestjs/testing";
import { NotesController } from "./notes.controller";
import { PrismaService } from "../prisma/prisma.service";
import { HttpAuthGuard } from "../auth/http-auth.guard";

describe("NotesController", () => {
  let controller: NotesController;
  let prisma: { document: jest.Mocked<any>; $transaction: jest.Mock };

  beforeEach(async () => {
    prisma = {
      document: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotesController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    })
      .overrideGuard(HttpAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<NotesController>(NotesController);
  });

  const user = { userId: "user-1" };

  it("listNotes: returns documents for the current user", async () => {
    const docs = [
      {
        id: "n1",
        title: "Test",
        path: "test",
        pinned: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    prisma.document.findMany.mockResolvedValue(docs);
    const result = await controller.listNotes(user as any);
    expect(result).toEqual(docs);
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", deleted: false } }),
    );
  });

  it("createNote: creates and returns a document", async () => {
    const doc = {
      id: "n2",
      title: "New",
      path: "new",
      pinned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.document.create.mockResolvedValue(doc);
    const result = await controller.createNote({ path: "new", title: "New" }, user as any);
    expect(result).toEqual(doc);
    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-1", path: "new", title: "New" }),
      }),
    );
  });

  it("updateNote: patches a document", async () => {
    const doc = {
      id: "n1",
      title: "Updated",
      path: "test",
      pinned: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.document.update.mockResolvedValue(doc);
    const result = await controller.updateNote(
      "n1",
      { title: "Updated", pinned: true },
      user as any,
    );
    expect(result).toEqual(doc);
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "n1", userId: "user-1" } }),
    );
  });

  it("deleteNote: hard deletes the document", async () => {
    prisma.document.delete.mockResolvedValue({});
    const result = await controller.deleteNote("n1", user as any);
    expect(result).toEqual({});
    expect(prisma.document.delete).toHaveBeenCalledWith({
      where: { id: "n1", userId: "user-1" },
    });
  });

  it("syncNotes: returns notes updated since the given timestamp", async () => {
    const docs = [
      {
        id: "n1",
        title: "T",
        path: "p",
        pinned: false,
        deleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    prisma.document.findMany.mockResolvedValue(docs);
    const result = await controller.syncNotes("2024-01-01T00:00:00Z", user as any);
    expect(result).toEqual(docs);
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user-1" }) }),
    );
  });
});
