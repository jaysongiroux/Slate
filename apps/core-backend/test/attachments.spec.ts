import { createTestApp, resetDatabase } from "./helpers/test-app";
import FormData from "form-data";

describe("AttachmentsService", () => {
  it("registers attachment metadata against a user-owned document", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const user = await prisma.user.create({
      data: {
        email: "media@example.com",
        displayName: "Media User",
        normalizedUsername: "media user",
      },
    });

    const document = await prisma.document.create({
      data: {
        id: "doc-media",
        userId: user.id,
        title: "Media",
        path: "media.md",
        markdown: "![image](./clip.png)",
        content: {},
      },
    });

    const attachmentsService = app.attachmentsService;
    const attachment = await attachmentsService.register({
      userId: user.id,
      containerType: "note",
      containerId: document.id,
      originalName: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 4096,
    });

    expect(attachment.containerType).toBe("note");
    expect(attachment.containerId).toBe(document.id);
    expect(attachment.storageKey).toContain(user.id);

    await app.close();
  });
});

describe("GET /api/attachments/list", () => {
  it("returns metadata for every non-deleted attachment owned by the user", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const user = await prisma.user.create({
      data: {
        email: "list@example.com",
        displayName: "List",
        normalizedUsername: "list",
      },
    });
    const accessToken = app.authService.issueTokens(user.id).accessToken;

    await app.attachmentsService.registerAndStore({
      buffer: Buffer.from("A"),
      originalName: "a.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      userId: user.id,
      containerType: "note",
      containerId: "note-1",
    });
    await app.attachmentsService.registerAndStore({
      buffer: Buffer.from("B"),
      originalName: "b.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      userId: user.id,
      containerType: "diagram",
      containerId: "diagram-1",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/attachments/list",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.attachments).toHaveLength(2);
    const containerTypes = body.attachments
      .map((a: { containerType: string }) => a.containerType)
      .sort();
    expect(containerTypes).toEqual(["diagram", "note"]);

    await app.close();
  });

  it("does not return attachments belonging to a different user", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const me = await prisma.user.create({
      data: { email: "me@list.com", displayName: "Me", normalizedUsername: "me" },
    });
    const them = await prisma.user.create({
      data: { email: "them@list.com", displayName: "Them", normalizedUsername: "them" },
    });
    const myToken = app.authService.issueTokens(me.id).accessToken;

    await app.attachmentsService.registerAndStore({
      buffer: Buffer.from("M"),
      originalName: "mine.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      userId: me.id,
      containerType: "note",
      containerId: "n",
    });
    await app.attachmentsService.registerAndStore({
      buffer: Buffer.from("T"),
      originalName: "theirs.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      userId: them.id,
      containerType: "note",
      containerId: "n",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/attachments/list",
      headers: { authorization: `Bearer ${myToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].originalName).toBe("mine.txt");

    await app.close();
  });
});

describe("Attachments upload route", () => {
  it("accepts containerType + containerId for a diagram", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const user = await prisma.user.create({
      data: {
        email: "route@example.com",
        displayName: "Route",
        normalizedUsername: "route",
      },
    });

    const attachment = await app.attachmentsService.registerAndStore({
      buffer: Buffer.from("PNGDATA"),
      originalName: "diagram-img.txt",
      mimeType: "text/plain",
      sizeBytes: 7,
      userId: user.id,
      containerType: "diagram",
      containerId: "diagram-xyz",
    });

    expect(attachment.containerType).toBe("diagram");
    expect(attachment.containerId).toBe("diagram-xyz");

    await app.close();
  });
});

describe("POST /api/attachments/bulk-import", () => {
  it("creates an attachment with the caller-provided ID and stores the binary as-is", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const user = await prisma.user.create({
      data: {
        email: "bulk@example.com",
        displayName: "Bulk",
        normalizedUsername: "bulk",
      },
    });
    const accessToken = app.authService.issueTokens(user.id).accessToken;

    const form = new FormData();
    form.append("file", Buffer.from("hello"), { filename: "hi.txt", contentType: "text/plain" });
    form.append("id", "att-imported-1");
    form.append("containerType", "note");
    form.append("containerId", "note-1");
    form.append("originalName", "hi.txt");
    form.append("mimeType", "text/plain");

    const res = await app.inject({
      method: "POST",
      url: "/api/attachments/bulk-import",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...form.getHeaders(),
      },
      payload: form.getBuffer(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.id).toBe("att-imported-1");

    const row = await prisma.attachment.findUnique({ where: { id: "att-imported-1" } });
    expect(row!.userId).toBe(user.id);
    expect(row!.containerType).toBe("note");
    expect(row!.containerId).toBe("note-1");
    expect(row!.mimeType).toBe("text/plain");
    expect(Number(row!.sizeBytes)).toBe(5);

    await app.close();
  });

  it("overwrites an existing attachment owned by the same user", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const user = await prisma.user.create({
      data: {
        email: "ow@example.com",
        displayName: "OW",
        normalizedUsername: "ow",
      },
    });
    const accessToken = app.authService.issueTokens(user.id).accessToken;

    const att = await app.attachmentsService.registerAndStore({
      buffer: Buffer.from("OLD"),
      originalName: "old.txt",
      mimeType: "text/plain",
      sizeBytes: 3,
      userId: user.id,
      containerType: "note",
      containerId: "n",
    });
    await prisma.attachment.update({ where: { id: att.id }, data: { id: "stable-id" } });

    const form = new FormData();
    form.append("file", Buffer.from("NEW-CONTENT"), {
      filename: "new.txt",
      contentType: "text/plain",
    });
    form.append("id", "stable-id");
    form.append("containerType", "note");
    form.append("containerId", "n");
    form.append("originalName", "new.txt");
    form.append("mimeType", "text/plain");

    const res = await app.inject({
      method: "POST",
      url: "/api/attachments/bulk-import",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...form.getHeaders(),
      },
      payload: form.getBuffer(),
    });
    expect(res.statusCode).toBe(200);

    const row = await prisma.attachment.findUnique({ where: { id: "stable-id" } });
    expect(row!.originalName).toBe("new.txt");
    expect(Number(row!.sizeBytes)).toBe(11);

    await app.close();
  });

  it("rejects when the id belongs to another user", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const me = await prisma.user.create({
      data: { email: "me-bulk@x.com", displayName: "Me", normalizedUsername: "me-bulk" },
    });
    const them = await prisma.user.create({
      data: { email: "th-bulk@x.com", displayName: "Them", normalizedUsername: "th-bulk" },
    });
    const meToken = app.authService.issueTokens(me.id).accessToken;

    const theirs = await app.attachmentsService.registerAndStore({
      buffer: Buffer.from("T"),
      originalName: "t.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      userId: them.id,
      containerType: "note",
      containerId: "n",
    });

    const form = new FormData();
    form.append("file", Buffer.from("STEAL"), {
      filename: "steal.txt",
      contentType: "text/plain",
    });
    form.append("id", theirs.id);
    form.append("containerType", "note");
    form.append("containerId", "n");
    form.append("originalName", "steal.txt");
    form.append("mimeType", "text/plain");

    const res = await app.inject({
      method: "POST",
      url: "/api/attachments/bulk-import",
      headers: {
        authorization: `Bearer ${meToken}`,
        ...form.getHeaders(),
      },
      payload: form.getBuffer(),
    });
    expect(res.statusCode).toBe(409);

    const row = await prisma.attachment.findUnique({ where: { id: theirs.id } });
    expect(row!.userId).toBe(them.id);
    expect(row!.originalName).toBe("t.txt");

    await app.close();
  });
});
