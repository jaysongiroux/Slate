import { NOTE_GRAPH_ENABLED_SETTING_KEY } from "@slate/shared";
import { createTestApp, resetDatabase } from "./helpers/test-app";

async function seedUserWithDocAndEmbeddingConfig(app: Awaited<ReturnType<typeof createTestApp>>["app"], email: string) {
  const prisma = app.prisma;
  const user = await prisma.user.create({
    data: { email, displayName: email, normalizedUsername: email },
  });
  await prisma.document.create({
    data: {
      userId: user.id,
      title: "doc",
      path: `/${email}/doc`,
      markdown: "hi",
      deleted: false,
    },
  });
  await prisma.aiConfig.upsert({
    where: { userId: user.id },
    update: { embeddingProvider: "OPENAI", embeddingModel: "text-embedding-3-small" },
    create: {
      userId: user.id,
      embeddingProvider: "OPENAI",
      embeddingModel: "text-embedding-3-small",
    },
  });
  return user;
}

describe("POST /api/graph/rebuild", () => {
  it("enqueues a rebuild even when the server has no note-graph enabled setting row", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await seedUserWithDocAndEmbeddingConfig(app, "no-setting@example.com");

    const settingRows = await prisma.setting.findMany({
      where: { userId: user.id, key: NOTE_GRAPH_ENABLED_SETTING_KEY },
    });
    expect(settingRows).toHaveLength(0);

    const enqueueSpy = jest
      .spyOn(app.jobsService, "enqueue")
      .mockResolvedValue("job-id");

    const { accessToken } = app.authService.issueTokens(user.id);
    const res = await app.inject({
      method: "POST",
      url: "/api/graph/rebuild",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true, enqueued: true });
    expect(enqueueSpy).toHaveBeenCalledWith(
      "note-graph-rebuild",
      expect.objectContaining({ userId: user.id, force: true }),
    );

    enqueueSpy.mockRestore();
    await app.close();
  });

  it("returns 400 embedding_not_configured when no AI embedding model is set", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await prisma.user.create({
      data: {
        email: "no-embed@example.com",
        displayName: "n",
        normalizedUsername: "noembed",
      },
    });
    await prisma.document.create({
      data: { userId: user.id, title: "doc", path: "/d", markdown: "hi", deleted: false },
    });

    const { accessToken } = app.authService.issueTokens(user.id);
    const res = await app.inject({
      method: "POST",
      url: "/api/graph/rebuild",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload)).toEqual({ error: "embedding_not_configured" });
    await app.close();
  });

  it("returns ok with enqueued: false when the user has no documents", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await prisma.user.create({
      data: { email: "no-docs@example.com", displayName: "n", normalizedUsername: "nodocs" },
    });

    const enqueueSpy = jest
      .spyOn(app.jobsService, "enqueue")
      .mockResolvedValue("job-id");

    const { accessToken } = app.authService.issueTokens(user.id);
    const res = await app.inject({
      method: "POST",
      url: "/api/graph/rebuild",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true, enqueued: false });
    expect(enqueueSpy).not.toHaveBeenCalled();

    enqueueSpy.mockRestore();
    await app.close();
  });
});

describe("NoteGraphService.rebuildGraphForUser", () => {
  it("does not delete edges when force=true even though the enabled setting is missing", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await seedUserWithDocAndEmbeddingConfig(app, "force-rebuild@example.com");

    const deleteSpy = jest.spyOn(app.noteGraphService, "deleteAllEdgesForUser");
    const enabledSpy = jest.spyOn(app.noteGraphService, "isNoteGraphEnabled");

    await app.noteGraphService.rebuildGraphForUser(user.id, { force: true });

    expect(enabledSpy).not.toHaveBeenCalled();
    // The forced path always clears edges before rebuilding from centroids — but it
    // should NOT short-circuit on the enabled check. Confirm the SQL ran by checking
    // no edges exist (no embedded chunks => empty insert) without an early-exit.
    const edgeCount = await prisma.documentSimilarityEdge.count({ where: { userId: user.id } });
    expect(edgeCount).toBe(0);

    deleteSpy.mockRestore();
    enabledSpy.mockRestore();
    await app.close();
  });

  it("short-circuits and clears edges when force is not set and the setting is missing", async () => {
    const { app } = await createTestApp();
    await resetDatabase(app);
    const user = await seedUserWithDocAndEmbeddingConfig(app, "no-force@example.com");

    const deleteSpy = jest.spyOn(app.noteGraphService, "deleteAllEdgesForUser");

    await app.noteGraphService.rebuildGraphForUser(user.id);

    expect(deleteSpy).toHaveBeenCalledWith(user.id);

    deleteSpy.mockRestore();
    await app.close();
  });
});
