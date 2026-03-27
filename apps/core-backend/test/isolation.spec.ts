import { createTestApp, resetDatabase } from "./helpers/test-app";
import { CrdtService } from "../src/documents/crdt.service";
import { DocumentsService } from "../src/documents/documents.service";

describe("User isolation", () => {
  it("only pulls changes for the authenticated user on a shared backend", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const userA = await prisma.user.create({
      data: {
        email: "a@example.com",
        displayName: "A",
        normalizedUsername: "a"
      }
    });

    const userB = await prisma.user.create({
      data: {
        email: "b@example.com",
        displayName: "B",
        normalizedUsername: "b"
      }
    });

    const documentsService = app.get(DocumentsService);
    const crdtService = app.get(CrdtService);

    await documentsService.pushDocumentUpdate({
      clientId: "desktop-a",
      documentId: "a-note",
      path: "a.md",
      deleted: false,
      pinned: false,
      crdtUpdate: crdtService.bootstrapFromMarkdown("a").crdtState,
      clientStateVector: Buffer.alloc(0),
    }, { userId: userA.id });

    await documentsService.pushDocumentUpdate({
      clientId: "desktop-b",
      documentId: "b-note",
      path: "b.md",
      deleted: false,
      pinned: false,
      crdtUpdate: crdtService.bootstrapFromMarkdown("b").crdtState,
      clientStateVector: Buffer.alloc(0),
    }, { userId: userB.id });

    const pullA = await documentsService.pullDocumentEvents({
      clientId: "desktop-a",
      sinceServerSeq: 0
    }, { userId: userA.id });

    expect(pullA.documents).toHaveLength(1);
    expect(pullA.documents[0]?.documentId).toBe("a-note");

    await app.close();
  });
});
