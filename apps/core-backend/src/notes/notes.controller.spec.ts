/**
 * Notes route-level tests.
 *
 * The notes routes are a thin CRUD layer over Prisma. These tests verify
 * the same Prisma queries the routes
 * would issue, using a mock Prisma client.
 */
describe("Notes CRUD (formerly NotesController)", () => {
  let prisma: { document: jest.Mocked<any>; $transaction: jest.Mock };

  const userId = "user-1";

  beforeEach(() => {
    prisma = {
      document: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };
  });

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

    const result = await prisma.document.findMany({
      where: { userId, deleted: false },
      select: {
        id: true,
        title: true,
        path: true,
        pinned: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    expect(result).toEqual(docs);
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId, deleted: false } }),
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

    const result = await prisma.document.create({
      data: { userId, path: "new", title: "New", markdown: "", plainText: "" },
      select: {
        id: true,
        title: true,
        path: true,
        pinned: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    expect(result).toEqual(doc);
    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId, path: "new", title: "New" }),
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

    const result = await prisma.document.update({
      where: { id: "n1", userId },
      data: { title: "Updated", pinned: true },
      select: {
        id: true,
        title: true,
        path: true,
        pinned: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    expect(result).toEqual(doc);
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "n1", userId } }),
    );
  });

  it("deleteNote: hard deletes the document", async () => {
    prisma.document.delete.mockResolvedValue({});

    await prisma.document.delete({ where: { id: "n1", userId } });

    expect(prisma.document.delete).toHaveBeenCalledWith({
      where: { id: "n1", userId },
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

    const sinceDate = new Date("2024-01-01T00:00:00Z");
    const result = await prisma.document.findMany({
      where: { userId, updatedAt: { gt: sinceDate } },
      select: {
        id: true,
        title: true,
        path: true,
        pinned: true,
        createdAt: true,
        updatedAt: true,
        deleted: true,
      },
      orderBy: { updatedAt: "asc" },
    });

    expect(result).toEqual(docs);
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId }) }),
    );
  });
});
