import { createTestApp, resetDatabase } from "../helpers/test-app";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@slate/server-db";

let app: FastifyInstance;
let prisma: PrismaClient;
let me: { id: string; accessToken: string };
let them: { id: string };

beforeAll(async () => {
  ({ app, prisma } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(app);
  const meUser = await prisma.user.create({
    data: {
      email: "me@conflicts.test",
      displayName: "Me",
      normalizedUsername: "me",
      isAdmin: false,
    },
  });
  const themUser = await prisma.user.create({
    data: {
      email: "them@conflicts.test",
      displayName: "Them",
      normalizedUsername: "them",
      isAdmin: false,
    },
  });
  const tokens = app.authService.issueTokens(meUser.id);
  me = { id: meUser.id, accessToken: tokens.accessToken };
  them = { id: themUser.id };
});

async function check(payload: object) {
  const res = await app.inject({
    method: "POST",
    url: "/api/replication/check-id-conflicts",
    headers: { authorization: `Bearer ${me.accessToken}` },
    payload,
  });
  return { statusCode: res.statusCode, body: JSON.parse(res.payload) };
}

describe("POST /api/replication/check-id-conflicts", () => {
  it("requires authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/replication/check-id-conflicts",
      payload: { folders: [], notes: [], diagrams: [], attachments: [], settings: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns empty arrays when no input is provided", async () => {
    const { statusCode, body } = await check({});
    expect(statusCode).toBe(200);
    expect(body).toEqual({
      folders: [],
      notes: [],
      diagrams: [],
      attachments: [],
      settings: [],
    });
  });

  it("returns empty arrays when none of the IDs exist on the server", async () => {
    const { statusCode, body } = await check({
      folders: ["does-not-exist-1"],
      notes: ["does-not-exist-2"],
      diagrams: ["does-not-exist-3"],
      attachments: ["does-not-exist-4"],
      settings: ["does-not-exist-5"],
    });
    expect(statusCode).toBe(200);
    expect(body).toEqual({
      folders: [],
      notes: [],
      diagrams: [],
      attachments: [],
      settings: [],
    });
  });

  it("does NOT report IDs owned by the authenticated user as conflicts", async () => {
    await prisma.folder.create({ data: { id: "self-folder", userId: me.id, path: "x" } });
    await prisma.document.create({
      data: { id: "self-note", userId: me.id, title: "x", path: "x", content: {}, markdown: "" },
    });
    await prisma.diagram.create({ data: { id: "self-diagram", userId: me.id, title: "x", scene: {} } });
    await prisma.setting.create({
      data: { id: "self-setting", userId: me.id, key: "x", value: "x" as any },
    });

    const { body } = await check({
      folders: ["self-folder"],
      notes: ["self-note"],
      diagrams: ["self-diagram"],
      settings: ["self-setting"],
    });
    expect(body).toEqual({
      folders: [],
      notes: [],
      diagrams: [],
      attachments: [],
      settings: [],
    });
  });

  it("reports IDs owned by another user as conflicts", async () => {
    await prisma.folder.create({ data: { id: "their-folder", userId: them.id, path: "x" } });
    await prisma.document.create({
      data: { id: "their-note", userId: them.id, title: "x", path: "x", content: {}, markdown: "" },
    });
    await prisma.diagram.create({
      data: { id: "their-diagram", userId: them.id, title: "x", scene: {} },
    });
    await prisma.setting.create({
      data: { id: "their-setting", userId: them.id, key: "x", value: "x" as any },
    });
    await prisma.attachment.create({
      data: {
        id: "their-attachment",
        userId: them.id,
        containerType: "note",
        containerId: "x",
        originalName: "x",
        mimeType: "text/plain",
        sizeBytes: BigInt(1),
        storageKey: "x",
        status: "uploaded",
      },
    });

    const { body } = await check({
      folders: ["their-folder", "absent"],
      notes: ["their-note", "absent"],
      diagrams: ["their-diagram", "absent"],
      attachments: ["their-attachment", "absent"],
      settings: ["their-setting", "absent"],
    });
    expect(body).toEqual({
      folders: ["their-folder"],
      notes: ["their-note"],
      diagrams: ["their-diagram"],
      attachments: ["their-attachment"],
      settings: ["their-setting"],
    });
  });

  it("mixes self-owned, other-owned, and absent in a single call", async () => {
    await prisma.folder.create({ data: { id: "f-self", userId: me.id, path: "a" } });
    await prisma.folder.create({ data: { id: "f-them", userId: them.id, path: "b" } });

    const { body } = await check({
      folders: ["f-self", "f-them", "f-absent"],
    });
    expect(body.folders).toEqual(["f-them"]);
  });

  it("ignores resource arrays that aren't supplied", async () => {
    await prisma.folder.create({ data: { id: "fld", userId: them.id, path: "x" } });

    // Only supply `folders`; the others should default to empty.
    const { body } = await check({ folders: ["fld"] });
    expect(body).toEqual({
      folders: ["fld"],
      notes: [],
      diagrams: [],
      attachments: [],
      settings: [],
    });
  });

  it("scopes per-resource — a conflicting note id does not pollute the diagrams response", async () => {
    await prisma.document.create({
      data: { id: "shared-id", userId: them.id, title: "x", path: "x", content: {}, markdown: "" },
    });

    const { body } = await check({
      notes: ["shared-id"],
      diagrams: ["shared-id"],
    });
    expect(body.notes).toEqual(["shared-id"]);
    // No Diagram row exists with id="shared-id", so it must NOT appear here.
    expect(body.diagrams).toEqual([]);
  });
});
