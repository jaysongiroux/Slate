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

describe("POST /api/replication/notes/pull", () => {
  it("returns empty array when no documents exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/replication/notes/pull",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        checkpoint: null,
        limit: 100,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.documents).toEqual([]);
    expect(body.checkpoint).toBeNull();
  });

  it("returns documents after checkpoint", async () => {
    await prisma.document.create({
      data: {
        userId,
        title: "Note 1",
        path: "note-1",
        content: {},
        markdown: "",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/notes/pull",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        checkpoint: null,
        limit: 100,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].title).toBe("Note 1");
    expect(body.checkpoint).toBeTruthy();
    expect(body.checkpoint.id).toBe(body.documents[0].id);
    expect(body.checkpoint.updatedAt).toBeTruthy();
  });
});

describe("POST /api/replication/notes/push", () => {
  it("creates a new document on push", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/replication/notes/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: null,
            newDocumentState: {
              id: "new-note-1",
              title: "New Note",
              path: "new-note",
              content: { type: "doc", content: [] },
              pinned: false,
              deleted: false,
              isTemplate: false,
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

    const doc = await prisma.document.findUnique({ where: { id: "new-note-1" } });
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("New Note");
  });

  it("returns conflict when assumedMasterState is stale", async () => {
    const doc = await prisma.document.create({
      data: {
        id: "existing-1",
        userId,
        title: "Original",
        path: "existing",
        content: {},
        markdown: "",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/notes/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: {
              id: "existing-1",
              title: "Stale Title",
              path: "existing",
              content: {},
              pinned: false,
              deleted: false,
              isTemplate: false,
              updatedAt: "2020-01-01T00:00:00.000Z",
              createdAt: doc.createdAt.toISOString(),
            },
            newDocumentState: {
              id: "existing-1",
              title: "Client Update",
              path: "existing",
              content: { type: "doc", content: [{ type: "paragraph" }] },
              pinned: false,
              deleted: false,
              isTemplate: false,
              updatedAt: new Date().toISOString(),
              createdAt: doc.createdAt.toISOString(),
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].title).toBe("Original");
  });
});
