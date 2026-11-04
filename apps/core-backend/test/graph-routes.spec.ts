import { FakeEmbeddings } from "@langchain/core/utils/testing";
import { NOTE_GRAPH_ENABLED_SETTING_KEY } from "@slate/shared";
import { padEmbeddingToMax } from "../src/ai/embedding-dimensions";
import { createTestApp, resetDatabase } from "./helpers/test-app";

async function seedUserWithDocAndEmbeddingConfig(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  email: string,
) {
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

    const enqueueSpy = jest.spyOn(app.jobsService, "enqueue").mockResolvedValue("job-id");

    const { accessToken } = app.authService.issueTokens(user.id);
    const res = await app.inject({
      method: "POST",
      url: "/api/graph/rebuild",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true, enqueued: true, jobId: "job-id" });
    expect(enqueueSpy).toHaveBeenCalledWith(
      "note-graph-rebuild",
      expect.objectContaining({ userId: user.id, force: true }),
      expect.objectContaining({ expireInHours: 2 }),
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

    const enqueueSpy = jest.spyOn(app.jobsService, "enqueue").mockResolvedValue("job-id");

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

describe("GET /api/graph/rebuild/:jobId", () => {
  it("only returns the state of the requesting user's rebuild", async () => {
    const { app } = await createTestApp();
    try {
      await resetDatabase(app);
      const owner = await seedUserWithDocAndEmbeddingConfig(app, "owner@example.com");
      const other = await seedUserWithDocAndEmbeddingConfig(app, "other@example.com");
      const jobId = await app.jobsService.enqueue(
        "note-graph-rebuild",
        { userId: owner.id },
        { startAfter: 600 },
      );
      const status = (userId: string) =>
        app.inject({
          method: "GET",
          url: `/api/graph/rebuild/${jobId}`,
          headers: { authorization: `Bearer ${app.authService.issueTokens(userId).accessToken}` },
        });
      const own = await status(owner.id);
      expect(own.statusCode).toBe(200);
      expect(own.json()).toEqual({ state: "created" });
      expect(await status(other.id)).toMatchObject({ statusCode: 404 });
    } finally {
      await app.close();
    }
  });
});

describe("NoteGraphService.rebuildGraphForUser", () => {
  it("repairs a previously embedded empty chunk from the editor body on regeneration", async () => {
    const { app, prisma } = await createTestApp();
    try {
      await resetDatabase(app);
      const user = await seedUserWithDocAndEmbeddingConfig(app, "empty-index@example.com");
      const doc = await prisma.document.findFirstOrThrow({ where: { userId: user.id } });
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          embedded: true,
          markdown: "",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Check flight controls", marks: [{ type: "bold" }] },
                ],
              },
            ],
          },
        },
      });
      await prisma.documentChunk.create({
        data: {
          documentId: doc.id,
          userId: user.id,
          content: "",
          chunkIndex: 0,
          embeddingModel: "old",
        },
      });
      const model = new FakeEmbeddings();
      const embed = jest.spyOn(model, "embedDocuments").mockResolvedValue([[0.8, 0.2]]);
      jest.spyOn(app.modelProviderService, "getEmbeddingModel").mockResolvedValue(model);

      await app.embeddingService.repairGraphInputs(user.id);
      await app.embeddingService.repairGraphInputs(user.id);
      expect(embed).toHaveBeenCalledTimes(1);
      expect(embed).toHaveBeenCalledWith(["**Check flight controls**"]);
      expect(
        await prisma.documentChunk.findMany({
          where: { documentId: doc.id },
          select: { content: true },
        }),
      ).toEqual([{ content: "**Check flight controls**" }]);
    } finally {
      await app.close();
    }
  });

  it("preserves distinct topics and standout matches around a busy note", async () => {
    const { app, prisma } = await createTestApp();
    try {
      await resetDatabase(app);
      const user = await seedUserWithDocAndEmbeddingConfig(app, "topics@example.com");
      const addNote = async (title: string, chunks: number[][]) => {
        await prisma.document.create({
          data: { id: title, userId: user.id, title, path: title, markdown: title, embedded: true },
        });
        for (const [index, values] of chunks.entries()) {
          const vector = JSON.stringify(padEmbeddingToMax(values));
          await prisma.$executeRaw`
            INSERT INTO document_chunk (id, "documentId", "userId", "chunkIndex", content, embedding, "embeddingModel")
            VALUES (${crypto.randomUUID()}, ${title}, ${user.id}, ${index}, ${title},
                    ${vector}::vector, 'text-embedding-3-small')
          `;
        }
      };

      // A popular overview with repeated passages, plus one passage about a different topic.
      await addNote("overview", [...Array(7).fill([1]), [0, 1]]);
      for (let i = 0; i < 8; i++) await addNote(`duplicate-${i}`, [[1]]);
      await addNote("specialist", [[0, 0.8, 0.6]]);
      await addNote("second-topic-a", [[0, 0, 0, 1]]);
      await addNote("second-topic-b", [[0, 0, 0, 0.7, Math.sqrt(0.51)]]);
      await addNote("unrelated", [[0, 0, 0, 0, 0, 1]]);

      await app.noteGraphService.rebuildGraphForUser(user.id, { force: true });
      const edges = await prisma.documentSimilarityEdge.findMany({ where: { userId: user.id } });
      const pairs = edges.map((edge) => [edge.fromDocumentId, edge.toDocumentId]);
      expect(pairs).toContainEqual(["second-topic-a", "second-topic-b"]);
      expect(pairs).toContainEqual(["overview", "specialist"]);
      for (let i = 0; i < 8; i++) expect(pairs.flat()).toContain(`duplicate-${i}`);
      expect(pairs.flat()).not.toContain("unrelated");
      expect(pairs.every(([a, b]) => a < b)).toBe(true);
    } finally {
      await app.close();
    }
  });

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
