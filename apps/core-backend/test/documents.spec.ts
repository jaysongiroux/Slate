import { createTestApp, resetDatabase } from "./helpers/test-app";
import { DocumentsService } from "../src/documents/documents.service";
import { SearchService } from "../src/search/search.service";

describe("DocumentsService", () => {
  it("persists documents, advances revisions, and supports full-text search", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const user = await prisma.user.create({
      data: {
        email: "grace@example.com",
        displayName: "Grace",
        normalizedUsername: "grace"
      }
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: "Grace Workspace",
        ownerUserId: user.id,
        members: {
          create: {
            userId: user.id,
            role: "OWNER"
          }
        }
      }
    });

    const documentsService = app.get(DocumentsService);
    const searchService = app.get(SearchService);

    await documentsService.upsert({
      clientId: "desktop-main",
      workspaceId: workspace.id,
      knownServerRevision: 0,
      document: {
        id: "note-1",
        ownerUserId: user.id,
        title: "Indexing Markdown",
        path: "notes/indexing-markdown.md",
        markdown: "# Indexing\n\nPostgres search for markdown notes.",
        plainText: "Indexing Postgres search for markdown notes."
      }
    });

    const pulled = await documentsService.pull({
      clientId: "desktop-main",
      workspaceId: workspace.id,
      lastSeenRevision: 0
    });

    expect(pulled.documents).toHaveLength(1);
    expect(pulled.latestRevision).toBe(1);

    const results = await searchService.search(workspace.id, "Postgres", 10);
    expect(results.results).toHaveLength(1);
    expect(results.results[0]?.documentId).toBe("note-1");

    await app.close();
  });

  it("returns a conflict when the client pushes against a stale revision", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const user = await prisma.user.create({
      data: {
        email: "linus@example.com",
        displayName: "Linus",
        normalizedUsername: "linus"
      }
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: "Linus Workspace",
        ownerUserId: user.id,
        members: {
          create: {
            userId: user.id,
            role: "OWNER"
          }
        }
      }
    });

    const documentsService = app.get(DocumentsService);

    await documentsService.upsert({
      clientId: "desktop-main",
      workspaceId: workspace.id,
      knownServerRevision: 0,
      document: {
        id: "note-2",
        ownerUserId: user.id,
        title: "First",
        path: "first.md",
        markdown: "first",
        plainText: "first"
      }
    });

    await documentsService.upsert({
      clientId: "desktop-main",
      workspaceId: workspace.id,
      knownServerRevision: 1,
      document: {
        id: "note-2",
        ownerUserId: user.id,
        title: "Second",
        path: "first.md",
        markdown: "second",
        plainText: "second"
      }
    });

    const stale = await documentsService.upsert({
      clientId: "desktop-laptop",
      workspaceId: workspace.id,
      knownServerRevision: 1,
      document: {
        id: "note-2",
        ownerUserId: user.id,
        title: "Outdated",
        path: "first.md",
        markdown: "outdated",
        plainText: "outdated"
      }
    });

    expect(stale.conflict?.documentId).toBe("note-2");
    expect(stale.conflict?.serverRevision).toBe(2);

    await app.close();
  });
});
