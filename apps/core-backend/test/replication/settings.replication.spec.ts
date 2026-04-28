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
