import { createTestApp, resetDatabase } from "../helpers/test-app";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@slate/server-db";

let app: FastifyInstance;
let prisma: PrismaClient;
let accessToken: string;
let userId: string;

beforeAll(async () => {
  ({ app, prisma } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(app);
  const user = await prisma.user.create({
    data: {
      email: "test@test.com",
      displayName: "Test",
      normalizedUsername: "test",
      isAdmin: false,
    },
  });
  userId = user.id;
  const tokens = app.authService.issueTokens(user.id);
  accessToken = tokens.accessToken;
});

describe("POST /api/replication/folders/pull", () => {
  it("returns folders for user", async () => {
    await prisma.folder.create({
      data: { userId, path: "journal" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/folders/pull",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { checkpoint: null, limit: 100 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].path).toBe("journal");
  });
});

describe("POST /api/replication/folders/push", () => {
  it("creates a new folder on push", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/replication/folders/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: null,
            newDocumentState: {
              id: "folder-1",
              path: "projects",
              updatedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.conflicts).toEqual([]);

    const folder = await prisma.folder.findUnique({ where: { id: "folder-1" } });
    expect(folder).not.toBeNull();
    expect(folder!.path).toBe("projects");
  });

  it("deletes an existing folder when RxDB pushes a deleted document", async () => {
    const folder = await prisma.folder.create({
      data: { id: "folder-to-delete", userId, path: "projects" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/folders/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: {
              id: "folder-to-delete",
              path: "projects",
              updatedAt: folder.updatedAt.toISOString(),
              createdAt: folder.createdAt.toISOString(),
            },
            newDocumentState: {
              id: "folder-to-delete",
              path: "projects",
              updatedAt: new Date().toISOString(),
              createdAt: folder.createdAt.toISOString(),
              _deleted: true,
            },
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.conflicts).toEqual([]);

    const deletedFolder = await prisma.folder.findUnique({ where: { id: "folder-to-delete" } });
    expect(deletedFolder).toBeNull();
  });
});

describe("POST /api/replication/folders/bulk-import", () => {
  it("creates folders with caller-provided IDs", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/replication/folders/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        documents: [
          {
            id: "fld-1",
            path: "folder-a",
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.imported).toBe(1);

    const folder = await prisma.folder.findUnique({ where: { id: "fld-1" } });
    expect(folder!.path).toBe("folder-a");
  });

  it("overwrites existing folders owned by the user", async () => {
    await prisma.folder.create({
      data: { id: "fld-2", userId, path: "old-name" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/folders/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        documents: [
          {
            id: "fld-2",
            path: "new-name",
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const folder = await prisma.folder.findUnique({ where: { id: "fld-2" } });
    expect(folder!.path).toBe("new-name");
  });

  it("skips folders owned by other users", async () => {
    const otherUser = await prisma.user.create({
      data: {
        email: "fldother@test.com",
        displayName: "FldOther",
        normalizedUsername: "fldother",
        isAdmin: false,
      },
    });
    await prisma.folder.create({
      data: { id: "fld-other", userId: otherUser.id, path: "theirs" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/folders/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        documents: [
          {
            id: "fld-other",
            path: "mine",
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.imported).toBe(0);
    expect(body.skipped).toBe(1);

    const folder = await prisma.folder.findUnique({ where: { id: "fld-other" } });
    expect(folder!.userId).toBe(otherUser.id);
  });

  it("auto-resolves path collisions within the same user", async () => {
    await prisma.folder.create({
      data: { id: "incumbent", userId, path: "shared" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/folders/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        documents: [
          {
            id: "newcomer",
            path: "shared",
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const newcomer = await prisma.folder.findUnique({ where: { id: "newcomer" } });
    expect(newcomer!.path).toMatch(/^shared-\d+$/);
  });
});
