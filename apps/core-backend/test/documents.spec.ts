import { createTestApp, resetDatabase } from "./helpers/test-app";
import { CrdtService } from "../src/documents/crdt.service";
import { DocumentsService } from "../src/documents/documents.service";
import { SearchService } from "../src/search/search.service";

describe("DocumentsService", () => {
  it("persists documents, advances server sequence, and supports full-text search", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const user = await prisma.user.create({
      data: {
        email: "grace@example.com",
        displayName: "Grace",
        normalizedUsername: "grace"
      }
    });

    const documentsService = app.get(DocumentsService);
    const searchService = app.get(SearchService);
    const crdtService = app.get(CrdtService);
    const bootstrap = crdtService.bootstrapFromMarkdown("# Indexing\n\nPostgres search for markdown notes.");

    const pushed = await documentsService.pushDocumentUpdate({
      clientId: "desktop-main",
      documentId: "note-1",
      path: "notes/indexing-markdown.md",
      deleted: false,
      crdtUpdate: bootstrap.crdtState,
      clientStateVector: Buffer.alloc(0),
    }, { userId: user.id });

    expect(pushed.serverSeq).toBe(1);

    const pulled = await documentsService.pullDocumentEvents({
      clientId: "desktop-main",
      sinceServerSeq: 0
    }, { userId: user.id });

    expect(pulled.documents).toHaveLength(1);
    expect(pulled.latestServerSeq).toBe(1);

    const results = await searchService.search(user.id, "Postgres", 10);
    expect(results.results).toHaveLength(1);
    expect(results.results[0]?.documentId).toBe("note-1");

    await app.close();
  });

  it("increments server sequence on repeated pushes", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const user = await prisma.user.create({
      data: {
        email: "linus@example.com",
        displayName: "Linus",
        normalizedUsername: "linus"
      }
    });

    const documentsService = app.get(DocumentsService);
    const crdtService = app.get(CrdtService);

    const firstPush = await documentsService.pushDocumentUpdate({
      clientId: "desktop-main",
      documentId: "note-2",
      path: "first.md",
      deleted: false,
      crdtUpdate: crdtService.bootstrapFromMarkdown("first").crdtState,
      clientStateVector: Buffer.alloc(0),
    }, { userId: user.id });

    const secondPush = await documentsService.pushDocumentUpdate({
      clientId: "desktop-main",
      documentId: "note-2",
      path: "first.md",
      deleted: false,
      crdtUpdate: crdtService.bootstrapFromMarkdown("second").crdtState,
      clientStateVector: Buffer.alloc(0),
    }, { userId: user.id });

    expect(firstPush.serverSeq).toBe(1);
    expect(secondPush.serverSeq).toBe(2);

    await app.close();
  });

  it("does not increment server sequence when content is unchanged", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const user = await prisma.user.create({
      data: {
        email: "alan@example.com",
        displayName: "Alan",
        normalizedUsername: "alan",
      },
    });

    const documentsService = app.get(DocumentsService);
    const crdtService = app.get(CrdtService);
    const bootstrap = crdtService.bootstrapFromMarkdown("# Same content");

    const firstPush = await documentsService.pushDocumentUpdate({
      clientId: "desktop-main",
      documentId: "note-dup",
      path: "same.md",
      deleted: false,
      crdtUpdate: bootstrap.crdtState,
      clientStateVector: Buffer.alloc(0),
    }, { userId: user.id });

    // Push the exact same CRDT state again
    const secondPush = await documentsService.pushDocumentUpdate({
      clientId: "desktop-main",
      documentId: "note-dup",
      path: "same.md",
      deleted: false,
      crdtUpdate: bootstrap.crdtState,
      clientStateVector: Buffer.alloc(0),
    }, { userId: user.id });

    expect(firstPush.serverSeq).toBe(1);
    expect(secondPush.serverSeq).toBe(1); // No change, no increment

    await app.close();
  });

  it("returns not found for a missing document snapshot", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const user = await prisma.user.create({
      data: {
        email: "ada@example.com",
        displayName: "Ada",
        normalizedUsername: "ada",
      },
    });

    const documentsService = app.get(DocumentsService);

    await expect(
      documentsService.getDocumentSnapshot(
        { documentId: "missing-note-id" },
        { userId: user.id },
      ),
    ).rejects.toThrow();

    await app.close();
  });
});
