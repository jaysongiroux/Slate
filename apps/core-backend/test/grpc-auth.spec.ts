import { Metadata } from "@grpc/grpc-js";
import { hash } from "argon2";
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { DocumentsController } from "../src/documents/documents.controller";
import { SearchController } from "../src/search/search.controller";
import { createTestApp, resetDatabase } from "./helpers/test-app";

describe("gRPC auth flow", () => {
  async function seedAuthenticatedUser() {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const passwordHash = await hash("secret-pass");
    const user = await prisma.user.create({
      data: {
        email: "grace@example.com",
        displayName: "Grace",
        normalizedUsername: "grace",
        passwordHash,
      },
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: "Grace Workspace",
        ownerUserId: user.id,
        members: {
          create: {
            userId: user.id,
            role: "OWNER",
          },
        },
      },
    });

    return { app, workspace, user };
  }

  it("validates a saved session from gRPC metadata", async () => {
    const { app, workspace, user } = await seedAuthenticatedUser();
    const authService = app.get(AuthService);
    const authController = app.get(AuthController);

    const session = await authService.loginWithPassword({
      email: user.email,
      password: "secret-pass",
      clientId: "desktop-main",
    });

    const metadata = new Metadata();
    metadata.set("authorization", `Bearer ${session.tokens.accessToken}`);

    const currentSession = await authController.getCurrentSession({}, metadata);
    expect(currentSession.userId).toBe(user.id);
    expect(currentSession.workspaceId).toBe(workspace.id);
    expect(currentSession.email).toBe(user.email);
    expect(currentSession.workspaceName).toBe(workspace.name);

    await app.close();
  });

  it("rejects unauthenticated document pulls and derives sync identity from the token", async () => {
    const { app, workspace, user } = await seedAuthenticatedUser();
    const authService = app.get(AuthService);
    const documentsController = app.get(DocumentsController);
    const searchController = app.get(SearchController);

    await expect(
      documentsController.pullChanges({ clientId: "desktop-main", workspaceId: "wrong", lastSeenRevision: 0 }, new Metadata())
    ).rejects.toBeDefined();

    const session = await authService.loginWithPassword({
      email: user.email,
      password: "secret-pass",
      clientId: "desktop-main",
    });

    const metadata = new Metadata();
    metadata.set("authorization", `Bearer ${session.tokens.accessToken}`);

    const upsert = await documentsController.upsertDocument(
      {
        clientId: "desktop-main",
        workspaceId: "wrong-workspace",
        knownServerRevision: 0,
        document: {
          id: "doc-1",
          ownerUserId: "wrong-user",
          title: "Secured note",
          path: "secured-note.md",
          markdown: "# Secured note",
          plainText: "Secured note",
        },
      },
      metadata
    );

    expect(upsert.document.workspaceId).toBe(workspace.id);
    expect(upsert.document.ownerUserId).toBe(user.id);

    const results = await searchController.searchDocuments(
      { workspaceId: "wrong-workspace", query: "Secured", limit: 5 },
      metadata
    );

    expect(results.results).toHaveLength(1);
    expect(results.results[0].documentId).toBe("doc-1");

    await app.close();
  });
});
