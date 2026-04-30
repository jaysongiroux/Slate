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

  it("pushes successfully when another user already owns a row with the same id", async () => {
    const otherUser = await prisma.user.create({
      data: {
        email: "collide@test.com",
        displayName: "Collide",
        normalizedUsername: "collide",
        isAdmin: false,
      },
    });
    await prisma.document.create({
      data: {
        id: "shared-cuid-id",
        userId: otherUser.id,
        title: "Theirs",
        path: "their-note",
        content: { type: "doc", content: [] },
        markdown: "their content",
      },
    });

    // Pre-fix: P2002 on `id` — push 500'd and the user could not sync notes at all.
    const res = await app.inject({
      method: "POST",
      url: "/api/replication/notes/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: null,
            newDocumentState: {
              id: "shared-cuid-id",
              title: "Mine",
              path: "my-note",
              content: { type: "doc", content: [] },
              markdown: "my content",
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
    expect(JSON.parse(res.payload).conflicts).toEqual([]);

    const myDoc = await prisma.document.findFirst({ where: { userId, path: "my-note" } });
    expect(myDoc).not.toBeNull();
    expect(myDoc!.title).toBe("Mine");
    expect(myDoc!.markdown).toBe("my content");

    // The other user's row is preserved untouched.
    const theirDoc = await prisma.document.findUnique({ where: { id: "shared-cuid-id" } });
    expect(theirDoc!.userId).toBe(otherUser.id);
    expect(theirDoc!.title).toBe("Theirs");
  });

  it("returns the user's note via pull using the desktop's original id (salted id stripped)", async () => {
    const otherUser = await prisma.user.create({
      data: {
        email: "collide2@test.com",
        displayName: "Collide2",
        normalizedUsername: "collide2",
        isAdmin: false,
      },
    });
    await prisma.document.create({
      data: {
        id: "dup-id",
        userId: otherUser.id,
        title: "Other",
        path: "other-path",
        content: {},
        markdown: "",
      },
    });

    const pushRes = await app.inject({
      method: "POST",
      url: "/api/replication/notes/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: null,
            newDocumentState: {
              id: "dup-id",
              title: "Mine",
              path: "mine",
              content: {},
              markdown: "",
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
    expect(pushRes.statusCode).toBe(200);

    const pullRes = await app.inject({
      method: "POST",
      url: "/api/replication/notes/pull",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { checkpoint: null, limit: 100 },
    });
    expect(pullRes.statusCode).toBe(200);
    const body = JSON.parse(pullRes.payload);
    expect(body.documents).toHaveLength(1);
    // The pulled doc reports the desktop's original id, not the server-side
    // salted form, so the local RxDB doc lines up rather than duplicating.
    expect(body.documents[0].id).toBe("dup-id");
    expect(body.documents[0].title).toBe("Mine");
  });

  it("subsequent pushes from the same user with the same colliding id are idempotent", async () => {
    const otherUser = await prisma.user.create({
      data: {
        email: "collide3@test.com",
        displayName: "Collide3",
        normalizedUsername: "collide3",
        isAdmin: false,
      },
    });
    await prisma.document.create({
      data: {
        id: "again-id",
        userId: otherUser.id,
        title: "Other",
        path: "other-path",
        content: {},
        markdown: "",
      },
    });

    const firstPush = await app.inject({
      method: "POST",
      url: "/api/replication/notes/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: null,
            newDocumentState: {
              id: "again-id",
              title: "First",
              path: "first",
              content: {},
              markdown: "",
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
    expect(firstPush.statusCode).toBe(200);
    const myRowAfterFirst = await prisma.document.findFirstOrThrow({
      where: { userId, path: "first" },
    });

    const secondPush = await app.inject({
      method: "POST",
      url: "/api/replication/notes/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: {
              id: "again-id",
              title: "First",
              path: "first",
              content: {},
              markdown: "",
              pinned: false,
              isDeleted: false,
              isTemplate: false,
              updatedAt: myRowAfterFirst.updatedAt.toISOString(),
              createdAt: myRowAfterFirst.createdAt.toISOString(),
            },
            newDocumentState: {
              id: "again-id",
              title: "Second",
              path: "first",
              content: {},
              markdown: "updated",
              pinned: false,
              deleted: false,
              isTemplate: false,
              updatedAt: new Date().toISOString(),
              createdAt: myRowAfterFirst.createdAt.toISOString(),
            },
          },
        ],
      },
    });
    expect(secondPush.statusCode).toBe(200);
    expect(JSON.parse(secondPush.payload).conflicts).toEqual([]);

    const allMine = await prisma.document.findMany({ where: { userId } });
    expect(allMine).toHaveLength(1);
    expect(allMine[0].title).toBe("Second");
    expect(allMine[0].markdown).toBe("updated");
  });

  it("accepts a note update when the assumed master only differs by server timestamps", async () => {
    const doc = await prisma.document.create({
      data: {
        id: "timestamp-drift-note",
        userId,
        title: "First edit",
        path: "timestamp-drift",
        content: {},
        markdown: "first edit",
        pinned: false,
        deleted: false,
        isTemplate: false,
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
              id: "timestamp-drift-note",
              title: "First edit",
              path: "timestamp-drift",
              content: {},
              markdown: "first edit",
              pinned: false,
              isDeleted: false,
              isTemplate: false,
              updatedAt: new Date(doc.updatedAt.getTime() - 1000).toISOString(),
              createdAt: new Date(doc.createdAt.getTime() - 1000).toISOString(),
            },
            newDocumentState: {
              id: "timestamp-drift-note",
              title: "Second edit",
              path: "timestamp-drift",
              content: {},
              markdown: "second edit",
              pinned: false,
              isDeleted: false,
              isTemplate: false,
              updatedAt: new Date().toISOString(),
              createdAt: doc.createdAt.toISOString(),
            },
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).conflicts).toEqual([]);

    const updated = await prisma.document.findUniqueOrThrow({
      where: { id: "timestamp-drift-note" },
    });
    expect(updated.title).toBe("Second edit");
    expect(updated.markdown).toBe("second edit");
  });

  it("accepts live note updates by server arrival even when assumed master is stale", async () => {
    const doc = await prisma.document.create({
      data: {
        id: "existing-1",
        userId,
        title: "Server version",
        path: "existing",
        content: {},
        markdown: "server",
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
              markdown: "stale",
              pinned: false,
              isDeleted: false,
              isTemplate: false,
              updatedAt: "2020-01-01T00:00:00.000Z",
              createdAt: doc.createdAt.toISOString(),
            },
            newDocumentState: {
              id: "existing-1",
              title: "Arrived later",
              path: "existing",
              content: { type: "doc", content: [{ type: "paragraph" }] },
              markdown: "arrived later",
              pinned: false,
              isDeleted: false,
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
    expect(body.conflicts).toEqual([]);

    const updated = await prisma.document.findUniqueOrThrow({ where: { id: "existing-1" } });
    expect(updated.title).toBe("Arrived later");
    expect(updated.markdown).toBe("arrived later");
  });

  it("keeps tombstoned notes deleted when a stale edit arrives later", async () => {
    const doc = await prisma.document.create({
      data: {
        id: "deleted-lww-note",
        userId,
        title: "Deleted",
        path: "__deleted__/deleted-lww-note",
        content: {},
        markdown: "",
        pinned: false,
        deleted: true,
        isTemplate: false,
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
              id: "deleted-lww-note",
              title: "Old live note",
              path: "deleted-lww-note",
              content: {},
              markdown: "old",
              pinned: false,
              isDeleted: false,
              isTemplate: false,
              updatedAt: "2026-01-01T00:00:00.000Z",
              createdAt: doc.createdAt.toISOString(),
            },
            newDocumentState: {
              id: "deleted-lww-note",
              title: "Stale edit",
              path: "deleted-lww-note",
              content: {},
              markdown: "stale edit",
              pinned: false,
              isDeleted: false,
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
    expect(body.conflicts[0].isDeleted).toBe(true);

    const updated = await prisma.document.findUniqueOrThrow({ where: { id: "deleted-lww-note" } });
    expect(updated.deleted).toBe(true);
    expect(updated.markdown).toBe("");
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
