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

describe("POST /api/replication/settings/push", () => {
  it("creates a new setting on push", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/replication/settings/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: null,
            newDocumentState: {
              id: "setting-1",
              key: "keyboardShortcuts",
              value: { "ctrl+s": "save" },
              updatedAt: new Date().toISOString(),
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.conflicts).toEqual([]);

    const setting = await prisma.setting.findUnique({ where: { id: "setting-1" } });
    expect(setting).not.toBeNull();
    expect(setting!.key).toBe("keyboardShortcuts");
  });
});

describe("POST /api/replication/settings/push cross-user id collision", () => {
  it("pushes successfully when a different user already owns a row with the same deterministic id", async () => {
    // Simulate user A having already pushed a setting with the deterministic id.
    const userA = await prisma.user.create({
      data: {
        email: "user-a@example.com",
        displayName: "A",
        normalizedUsername: "usera",
        isAdmin: false,
      },
    });
    await prisma.setting.create({
      data: {
        id: "setting-extensions.noteGraphEnabled",
        userId: userA.id,
        key: "extensions.noteGraphEnabled",
        value: true,
      },
    });

    // Now user B (the test's `userId`) pushes the same deterministic id — pre-fix
    // this 500'd with P2002 on `id`, and the setting never reached the server.
    const res = await app.inject({
      method: "POST",
      url: "/api/replication/settings/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: null,
            newDocumentState: {
              id: "setting-extensions.noteGraphEnabled",
              key: "extensions.noteGraphEnabled",
              value: true,
              updatedAt: new Date().toISOString(),
            },
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).conflicts).toEqual([]);

    // User B should now own a row with the same key.
    const stored = await prisma.setting.findFirst({
      where: { userId, key: "extensions.noteGraphEnabled" },
    });
    expect(stored).not.toBeNull();
    expect(stored!.value).toBe(true);
    // User A's row must be untouched.
    const aStill = await prisma.setting.findFirst({
      where: { userId: userA.id, key: "extensions.noteGraphEnabled" },
    });
    expect(aStill?.id).toBe("setting-extensions.noteGraphEnabled");
    expect(aStill?.value).toBe(true);
  });

  it("re-pushing the same key updates the existing row (idempotent) without creating duplicates", async () => {
    const firstRes = await app.inject({
      method: "POST",
      url: "/api/replication/settings/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: null,
            newDocumentState: {
              id: "setting-theme",
              key: "theme",
              value: "dark",
              updatedAt: new Date().toISOString(),
            },
          },
        ],
      },
    });
    expect(firstRes.statusCode).toBe(200);
    const firstRow = await prisma.setting.findFirstOrThrow({ where: { userId, key: "theme" } });

    const secondRes = await app.inject({
      method: "POST",
      url: "/api/replication/settings/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        changeRows: [
          {
            assumedMasterState: {
              id: firstRow.id,
              key: "theme",
              value: "dark",
              updatedAt: firstRow.updatedAt.toISOString(),
            },
            newDocumentState: {
              id: "setting-theme",
              key: "theme",
              value: "light",
              updatedAt: new Date().toISOString(),
            },
          },
        ],
      },
    });
    expect(secondRes.statusCode).toBe(200);
    expect(JSON.parse(secondRes.payload).conflicts).toEqual([]);

    const rows = await prisma.setting.findMany({ where: { userId, key: "theme" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("light");
  });
});

describe("POST /api/replication/settings/pull", () => {
  it("returns settings for user", async () => {
    await prisma.setting.create({
      data: { userId, key: "theme", value: "dark" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/settings/pull",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { checkpoint: null, limit: 100 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].key).toBe("theme");
    expect(body.documents[0].value).toBe("dark");
  });
});

describe("POST /api/replication/settings/bulk-import", () => {
  it("creates plain setting rows for the user", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/replication/settings/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        documents: [
          {
            id: "setting-shortcut",
            key: "keyboardShortcuts",
            value: { save: "cmd+s" },
            updatedAt: new Date().toISOString(),
          },
          {
            id: "setting-flag",
            key: "extensions.diagramsEnabled",
            value: true,
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.imported).toBe(2);
    expect(body.rejected).toBe(0);

    const rows = await prisma.setting.findMany({
      where: { userId },
      orderBy: { key: "asc" },
    });
    expect(rows).toHaveLength(2);
  });

  it("rejects rows whose key matches the encrypted denylist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/replication/settings/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        documents: [
          {
            id: "good",
            key: "extensions.diagramsEnabled",
            value: true,
            updatedAt: new Date().toISOString(),
          },
          {
            id: "bad-1",
            key: "linkwarden.tokens",
            value: "encrypted-junk",
            updatedAt: new Date().toISOString(),
          },
          {
            id: "bad-2",
            key: "future.tokens",
            value: "encrypted-junk",
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.imported).toBe(1);
    expect(body.rejected).toBe(2);

    const rows = await prisma.setting.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("extensions.diagramsEnabled");
  });

  it("does not error when an incumbent row holds the same id with a different key", async () => {
    // Reproduces the P2002 the production migration hit: incumbent row exists
    // with the same id (e.g. legacy data) but a different key, so a naive
    // (userId, key) lookup would miss it and fall into the create path.
    await prisma.setting.create({
      data: {
        id: "legacy-id",
        userId,
        key: "legacy.key",
        value: "legacy" as any,
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/settings/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        documents: [
          {
            id: "legacy-id",
            key: "extensions.diagramsEnabled",
            value: true,
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.imported).toBe(1);

    const row = await prisma.setting.findUnique({ where: { id: "legacy-id" } });
    expect(row!.key).toBe("extensions.diagramsEnabled");
    expect(row!.value).toBe(true);
  });

  it("when both id and (userId, key) collide on different rows, removes the conflicting row and updates the incumbent", async () => {
    await prisma.setting.create({
      data: {
        id: "incumbent-id",
        userId,
        key: "old.key",
        value: 1 as any,
      },
    });
    await prisma.setting.create({
      data: {
        id: "other-id",
        userId,
        key: "new.key",
        value: 2 as any,
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/settings/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        documents: [
          {
            id: "incumbent-id",
            key: "new.key",
            value: 3,
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const incumbent = await prisma.setting.findUnique({ where: { id: "incumbent-id" } });
    expect(incumbent!.key).toBe("new.key");
    expect(incumbent!.value).toBe(3);

    const other = await prisma.setting.findUnique({ where: { id: "other-id" } });
    expect(other).toBeNull();
  });

  it("overwrites by (userId, key) when the same key already exists", async () => {
    await prisma.setting.create({
      data: {
        id: "old-id",
        userId,
        key: "keyboardShortcuts",
        value: { save: "cmd+s" } as any,
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/replication/settings/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        documents: [
          {
            id: "new-id",
            key: "keyboardShortcuts",
            value: { save: "cmd+shift+s" },
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const rows = await prisma.setting.findMany({ where: { userId, key: "keyboardShortcuts" } });
    expect(rows).toHaveLength(1);
    expect((rows[0].value as any).save).toBe("cmd+shift+s");
  });
});
