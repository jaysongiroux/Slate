import { Metadata } from "@grpc/grpc-js";
import { hash } from "argon2";
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { CrdtService } from "../src/documents/crdt.service";
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

    return { app, user };
  }

  it("validates a saved session from gRPC metadata", async () => {
    const { app, user } = await seedAuthenticatedUser();
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
    expect(currentSession.email).toBe(user.email);
    expect(currentSession).not.toHaveProperty("workspaceId");
    expect(currentSession).not.toHaveProperty("workspaceName");

    await app.close();
  });

  it("rejects unauthenticated pulls and derives sync identity from the token", async () => {
    const { app } = await seedAuthenticatedUser();
    const authService = app.get(AuthService);
    const crdtService = app.get(CrdtService);
    const documentsController = app.get(DocumentsController);
    const searchController = app.get(SearchController);

    await expect(
      documentsController.pullDocumentEvents({ clientId: "desktop-main", sinceServerSeq: 0 }, new Metadata())
    ).rejects.toBeDefined();

    const session = await authService.loginWithPassword({
      email: "grace@example.com",
      password: "secret-pass",
      clientId: "desktop-main",
    });

    const metadata = new Metadata();
    metadata.set("authorization", `Bearer ${session.tokens.accessToken}`);

    const upsert = await documentsController.pushDocumentUpdate(
      {
        clientId: "desktop-main",
        documentId: "doc-1",
        path: "secured-note.md",
        deleted: false,
        crdtUpdate: crdtService.bootstrapFromMarkdown("# Secured note").crdtState,
        clientStateVector: Buffer.alloc(0),
      },
      metadata
    );

    expect(upsert.serverSeq).toBe(1);

    const results = await searchController.searchDocuments(
      { query: "Secured", limit: 5 },
      metadata
    );

    expect(results.results).toHaveLength(1);
    expect(results.results[0].documentId).toBe("doc-1");

    await app.close();
  });
});
