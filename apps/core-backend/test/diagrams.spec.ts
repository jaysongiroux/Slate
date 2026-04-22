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
