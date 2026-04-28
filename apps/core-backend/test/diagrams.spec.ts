import { createTestApp, resetDatabase } from "./helpers/test-app";

describe("DiagramsService", () => {
  it("creates a diagram scoped to the user", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await prisma.user.create({
      data: { email: "dia@example.com", displayName: "Dia", normalizedUsername: "dia" },
    });

    const diagram = await app.diagramsService.create({
      userId: user.id,
      title: "My First Diagram",
    });

    expect(diagram.title).toBe("My First Diagram");
    expect(diagram.userId).toBe(user.id);
    expect(diagram.scene).toEqual({});
    await app.close();
  });

  it("lists only non-deleted diagrams for the user, most-recent first", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await prisma.user.create({
      data: { email: "l@example.com", displayName: "L", normalizedUsername: "l" },
    });
    const a = await app.diagramsService.create({ userId: user.id, title: "A" });
    const b = await app.diagramsService.create({ userId: user.id, title: "B" });
    await app.diagramsService.softDelete({ userId: user.id, id: a.id });

    const list = await app.diagramsService.list({ userId: user.id });
    expect(list.map((d) => d.id)).toEqual([b.id]);
    await app.close();
  });

  it("updates scene and title", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await prisma.user.create({
      data: { email: "u@example.com", displayName: "U", normalizedUsername: "u" },
    });
    const d = await app.diagramsService.create({ userId: user.id, title: "A" });

    const updated = await app.diagramsService.update({
      userId: user.id,
      id: d.id,
      title: "Renamed",
      scene: { elements: [{ id: "1" }], appState: {}, files: {} },
    });

    expect(updated.title).toBe("Renamed");
    expect((updated.scene as any).elements[0].id).toBe("1");
    await app.close();
  });

  it("refuses cross-user access", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const u1 = await prisma.user.create({
      data: { email: "1@x.com", displayName: "1", normalizedUsername: "1" },
    });
    const u2 = await prisma.user.create({
      data: { email: "2@x.com", displayName: "2", normalizedUsername: "2" },
    });
    const d = await app.diagramsService.create({ userId: u1.id, title: "Mine" });

    await expect(
      app.diagramsService.update({ userId: u2.id, id: d.id, title: "Stolen" }),
    ).rejects.toThrow();
    await app.close();
  });
});

describe("Diagrams HTTP routes", () => {
  it("returns 401 for unauthenticated GET /api/diagrams", async () => {
    const { app } = await createTestApp();
    await resetDatabase(app);
    const res = await app.inject({ method: "GET", url: "/api/diagrams" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /api/diagrams returns the user's diagrams", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await prisma.user.create({
      data: { email: "http-list@example.com", displayName: "H", normalizedUsername: "httplist" },
    });
    const { accessToken } = app.authService.issueTokens(user.id);
    await app.diagramsService.create({ userId: user.id, title: "Alpha" });
    await app.diagramsService.create({ userId: user.id, title: "Beta" });

    const res = await app.inject({
      method: "GET",
      url: "/api/diagrams",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((d: { title: string }) => d.title).sort()).toEqual(["Alpha", "Beta"]);
    await app.close();
  });

  it("POST /api/diagrams creates a diagram with provided title", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await prisma.user.create({
      data: {
        email: "http-create@example.com",
        displayName: "H",
        normalizedUsername: "httpcreate",
      },
    });
    const { accessToken } = app.authService.issueTokens(user.id);

    const res = await app.inject({
      method: "POST",
      url: "/api/diagrams",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { title: "Sketch" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.title).toBe("Sketch");
    expect(body.userId).toBe(user.id);
    expect(body.scene).toEqual({});
    await app.close();
  });

  it("POST /api/diagrams falls back to 'Untitled Diagram' when no title provided", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await prisma.user.create({
      data: {
        email: "http-untitled@example.com",
        displayName: "H",
        normalizedUsername: "httpuntitled",
      },
    });
    const { accessToken } = app.authService.issueTokens(user.id);

    const res = await app.inject({
      method: "POST",
      url: "/api/diagrams",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.title).toBe("Untitled Diagram");
    await app.close();
  });

  it("PATCH /api/diagrams/:id updates scene and title", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await prisma.user.create({
      data: {
        email: "http-update@example.com",
        displayName: "H",
        normalizedUsername: "httpupdate",
      },
    });
    const { accessToken } = app.authService.issueTokens(user.id);
    const d = await app.diagramsService.create({ userId: user.id, title: "Original" });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/diagrams/${d.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        title: "Renamed",
        scene: { elements: [{ id: "el-1" }], appState: {}, files: {} },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.title).toBe("Renamed");
    expect(body.scene.elements[0].id).toBe("el-1");
    await app.close();
  });

  it("DELETE /api/diagrams/:id soft-deletes the diagram", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await prisma.user.create({
      data: {
        email: "http-delete@example.com",
        displayName: "H",
        normalizedUsername: "httpdelete",
      },
    });
    const { accessToken } = app.authService.issueTokens(user.id);
    const d = await app.diagramsService.create({ userId: user.id, title: "ToDelete" });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/diagrams/${d.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);

    const remaining = await app.diagramsService.list({ userId: user.id });
    expect(remaining.map((r) => r.id)).not.toContain(d.id);

    const row = await prisma.diagram.findUnique({ where: { id: d.id } });
    expect(row?.deleted).toBe(true);
    await app.close();
  });
});

describe("POST /api/diagrams/bulk-import", () => {
  it("creates diagrams with caller-provided IDs", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await prisma.user.create({
      data: { email: "bd1@example.com", displayName: "BD1", normalizedUsername: "bd1" },
    });
    const { accessToken } = app.authService.issueTokens(user.id);

    const res = await app.inject({
      method: "POST",
      url: "/api/diagrams/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        diagrams: [
          {
            id: "dg-1",
            title: "First",
            scene: { foo: "bar" },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "dg-2",
            title: "Second",
            scene: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.imported).toBe(2);

    const rows = await prisma.diagram.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(2);
    const titles = rows.map((r) => r.title).sort();
    expect(titles).toEqual(["First", "Second"]);

    await app.close();
  });

  it("overwrites existing diagrams owned by the user", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await prisma.user.create({
      data: { email: "bd2@example.com", displayName: "BD2", normalizedUsername: "bd2" },
    });
    const { accessToken } = app.authService.issueTokens(user.id);
    await prisma.diagram.create({
      data: { id: "dg-3", userId: user.id, title: "Old", scene: {} },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/diagrams/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        diagrams: [
          {
            id: "dg-3",
            title: "New",
            scene: { changed: true },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const row = await prisma.diagram.findUnique({ where: { id: "dg-3" } });
    expect(row!.title).toBe("New");
    expect((row!.scene as any).changed).toBe(true);

    await app.close();
  });

  it("skips diagrams owned by other users", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const me = await prisma.user.create({
      data: { email: "bd3@example.com", displayName: "BD3", normalizedUsername: "bd3" },
    });
    const them = await prisma.user.create({
      data: {
        email: "dgother@example.com",
        displayName: "DgOther",
        normalizedUsername: "dgother",
      },
    });
    const { accessToken } = app.authService.issueTokens(me.id);
    await prisma.diagram.create({
      data: { id: "dg-other", userId: them.id, title: "Theirs", scene: {} },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/diagrams/bulk-import",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        diagrams: [
          {
            id: "dg-other",
            title: "Mine",
            scene: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.imported).toBe(0);
    expect(body.skipped).toBe(1);

    const row = await prisma.diagram.findUnique({ where: { id: "dg-other" } });
    expect(row!.userId).toBe(them.id);
    expect(row!.title).toBe("Theirs");

    await app.close();
  });
});
