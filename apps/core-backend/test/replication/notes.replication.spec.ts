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

describe("POST /api/replication/notes/bulk-import", () => {
  it("creates new documents with caller-provided IDs", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/replication/notes/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        documents: [
          {
            id: "imp-1",
            title: "Imported A",
            path: "imp-a",
            content: { type: "doc", content: [] },
            markdown: "A",
            pinned: false,
            isDeleted: false,
            isTemplate: false,
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
          {
            id: "imp-2",
            title: "Imported B",
            path: "imp-b",
            content: { type: "doc", content: [] },
            markdown: "B",
            pinned: true,
            isDeleted: false,
            isTemplate: false,
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.imported).toBe(2);

    const docs = await prisma.document.findMany({
      where: { userId },
      orderBy: { id: "asc" },
    });
    expect(docs).toHaveLength(2);
    expect(docs[0].id).toBe("imp-1");
    expect(docs[0].title).toBe("Imported A");
    expect(docs[1].id).toBe("imp-2");
    expect(docs[1].pinned).toBe(true);
  });

  it("overwrites existing documents that share the user's id", async () => {
    await prisma.document.create({
      data: {
        id: "imp-3",
        userId,
        title: "Old",
        path: "imp-c",
        content: {},
        markdown: "old",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/notes/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        documents: [
          {
            id: "imp-3",
            title: "New",
            path: "imp-c",
            content: { type: "doc", content: [{ type: "paragraph" }] },
            markdown: "new",
            pinned: false,
            isDeleted: false,
            isTemplate: false,
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const doc = await prisma.document.findUnique({ where: { id: "imp-3" } });
    expect(doc!.title).toBe("New");
    expect(doc!.markdown).toBe("new");
  });

  it("refuses to overwrite a row owned by another user", async () => {
    const otherUser = await prisma.user.create({
      data: {
        email: "other@test.com",
        displayName: "Other",
        normalizedUsername: "other",
        isAdmin: false,
      },
    });
    await prisma.document.create({
      data: {
        id: "owned-by-other",
        userId: otherUser.id,
        title: "Theirs",
        path: "their-path",
        content: {},
        markdown: "",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/notes/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        documents: [
          {
            id: "owned-by-other",
            title: "Mine",
            path: "my-path",
            content: {},
            markdown: "",
            pinned: false,
            isDeleted: false,
            isTemplate: false,
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

    const doc = await prisma.document.findUnique({ where: { id: "owned-by-other" } });
    expect(doc!.userId).toBe(otherUser.id);
    expect(doc!.title).toBe("Theirs");
  });

  it("auto-resolves path collisions within the same user", async () => {
    await prisma.document.create({
      data: {
        id: "incumbent",
        userId,
        title: "Incumbent",
        path: "shared-path",
        content: {},
        markdown: "",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/notes/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        documents: [
          {
            id: "newcomer",
            title: "Newcomer",
            path: "shared-path",
            content: {},
            markdown: "",
            pinned: false,
            isDeleted: false,
            isTemplate: false,
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const newcomer = await prisma.document.findUnique({ where: { id: "newcomer" } });
    expect(newcomer!.path).toMatch(/^shared-path-\d+$/);
  });

  it("rejects when more than 200 documents per request", async () => {
    const documents = Array.from({ length: 201 }, (_, i) => ({
      id: `bulk-${i}`,
      title: `Bulk ${i}`,
      path: `bulk-${i}`,
      content: {},
      markdown: "",
      pinned: false,
      isDeleted: false,
      isTemplate: false,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }));

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/notes/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { documents },
    });
    expect(res.statusCode).toBe(400);
  });
});
