import { createTestApp, resetDatabase } from "./helpers/test-app";
import { DocumentsService } from "../src/documents/documents.service";

describe("Workspace isolation", () => {
  it("only pulls changes for the active workspace on a shared backend", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const userA = await prisma.user.create({
      data: {
        email: "a@example.com",
        displayName: "A"
      }
    });

    const userB = await prisma.user.create({
      data: {
        email: "b@example.com",
        displayName: "B"
      }
    });

    const workspaceA = await prisma.workspace.create({
      data: {
        name: "Workspace A",
        ownerUserId: userA.id,
        members: {
          create: {
            userId: userA.id,
            role: "OWNER"
          }
        }
      }
    });

    const workspaceB = await prisma.workspace.create({
      data: {
        name: "Workspace B",
        ownerUserId: userB.id,
        members: {
          create: {
            userId: userB.id,
            role: "OWNER"
          }
        }
      }
    });

    const documentsService = app.get(DocumentsService);

    await documentsService.upsert({
      clientId: "desktop-a",
      workspaceId: workspaceA.id,
      knownServerRevision: 0,
      document: {
        id: "a-note",
        ownerUserId: userA.id,
        title: "A only",
        path: "a.md",
        markdown: "a",
        plainText: "a"
      }
    });

    await documentsService.upsert({
      clientId: "desktop-b",
      workspaceId: workspaceB.id,
      knownServerRevision: 0,
      document: {
        id: "b-note",
        ownerUserId: userB.id,
        title: "B only",
        path: "b.md",
        markdown: "b",
        plainText: "b"
      }
    });

    const pullA = await documentsService.pull({
      clientId: "desktop-a",
      workspaceId: workspaceA.id,
      lastSeenRevision: 0
    });

    expect(pullA.documents).toHaveLength(1);
    expect(pullA.documents[0]?.id).toBe("a-note");

    await app.close();
  });
});

