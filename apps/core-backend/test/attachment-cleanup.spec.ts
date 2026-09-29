import { mkdtemp, writeFile, utimes, readdir, stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppConfigName } from "@slate/server-db";
import { createTestApp, resetDatabase } from "./helpers/test-app";

async function pointStorageAtTempDir(app: Awaited<ReturnType<typeof createTestApp>>["app"]) {
  const root = await mkdtemp(join(tmpdir(), "slate-gc-"));
  await app.settingsService.setSettingValue(AppConfigName.STORAGE_FILESYSTEM_ROOT, root);
  await app.storageService.reinitialize();
  return root;
}

async function writeOrphanFile(root: string, relativeKey: string, mtime: Date) {
  const absolute = join(root, relativeKey);
  await mkdir(join(absolute, ".."), { recursive: true });
  await writeFile(absolute, "leftover");
  await utimes(absolute, mtime, mtime);
  return absolute;
}

async function createUser(app: Awaited<ReturnType<typeof createTestApp>>["app"], email: string) {
  return app.prisma.user.create({
    data: { email, displayName: email, normalizedUsername: email },
  });
}

describe("registerAndStore saga", () => {
  it("rolls back the pending DB row when the storage write fails", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    await pointStorageAtTempDir(app);

    const user = await createUser(app, "saga-put@example.com");

    const storeSpy = jest
      .spyOn(app.storageService, "store")
      .mockRejectedValueOnce(new Error("disk full"));

    await expect(
      app.attachmentsService.registerAndStore({
        buffer: Buffer.from("hello"),
        originalName: "hello.txt",
        mimeType: "text/plain",
        sizeBytes: 5,
        userId: user.id,
        containerType: "note",
        containerId: "note-saga",
      }),
    ).rejects.toThrow("disk full");

    const rows = await prisma.attachment.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(0);

    storeSpy.mockRestore();
    await app.close();
  });

  it("rolls back both the file and the pending row when the status-update fails", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const root = await pointStorageAtTempDir(app);

    const user = await createUser(app, "saga-update@example.com");

    const updateSpy = jest
      .spyOn(prisma.attachment, "update")
      .mockRejectedValueOnce(new Error("update failed"));

    await expect(
      app.attachmentsService.registerAndStore({
        buffer: Buffer.from("payload"),
        originalName: "doc.txt",
        mimeType: "text/plain",
        sizeBytes: 7,
        userId: user.id,
        containerType: "note",
        containerId: "note-update",
      }),
    ).rejects.toThrow("update failed");

    const rows = await prisma.attachment.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(0);

    const filesLeft = await readdir(join(root, user.id)).catch(() => []);
    expect(filesLeft).toHaveLength(0);

    updateSpy.mockRestore();
    await app.close();
  });

  it("ends in uploaded status on the happy path and writes the file to storage", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const root = await pointStorageAtTempDir(app);

    const user = await createUser(app, "saga-happy@example.com");

    const result = await app.attachmentsService.registerAndStore({
      buffer: Buffer.from("payload"),
      originalName: "doc.txt",
      mimeType: "text/plain",
      sizeBytes: 7,
      userId: user.id,
      containerType: "note",
      containerId: "note-happy",
    });

    expect(result.status).toBe("uploaded");
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.status).toBe("uploaded");

    const filePath = join(root, row.storageKey);
    await expect(stat(filePath)).resolves.toMatchObject({});

    await app.close();
  });
});

describe("runGarbageCollection", () => {
  const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago

  it("reaps stale pending rows past the grace period (Phase 0)", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const root = await pointStorageAtTempDir(app);

    const user = await createUser(app, "phase0@example.com");

    // Stale pending, with a file left behind by a crashed upload
    const staleKey = `${user.id}/stale.bin`;
    await writeOrphanFile(root, staleKey, oldDate);
    const stale = await prisma.attachment.create({
      data: {
        userId: user.id,
        containerType: "note",
        containerId: "c",
        originalName: "stale.bin",
        mimeType: "application/octet-stream",
        sizeBytes: BigInt(8),
        storageKey: staleKey,
        status: "pending",
        createdAt: oldDate,
      },
    });

    // Fresh pending (uploaded seconds ago) — must NOT be reaped
    const fresh = await prisma.attachment.create({
      data: {
        userId: user.id,
        containerType: "note",
        containerId: "c",
        originalName: "fresh.bin",
        mimeType: "application/octet-stream",
        sizeBytes: BigInt(8),
        storageKey: `${user.id}/fresh.bin`,
        status: "pending",
      },
    });

    await app.jobHandlers.runGarbageCollection();

    expect(await prisma.attachment.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await prisma.attachment.findUnique({ where: { id: fresh.id } })).not.toBeNull();

    await app.close();
  });

  it("keeps a diagram-referenced attachment uploaded past the grace period (Phase 1)", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    await pointStorageAtTempDir(app);

    const user = await createUser(app, "diagram-ref@example.com");

    const diagram = await prisma.diagram.create({
      data: {
        userId: user.id,
        title: "test diagram",
        scene: { elements: [], appState: {}, files: {} },
      },
    });

    const attachment = await prisma.attachment.create({
      data: {
        userId: user.id,
        containerType: "diagram",
        containerId: diagram.id,
        originalName: "image.png",
        mimeType: "image/png",
        sizeBytes: BigInt(1024),
        storageKey: `${user.id}/image.png`,
        status: "uploaded",
        createdAt: oldDate,
      },
    });

    await prisma.diagram.update({
      where: { id: diagram.id },
      data: {
        scene: {
          elements: [],
          appState: {},
          files: {
            f1: {
              id: "f1",
              dataURL: `attachment:${attachment.id}`,
              mimeType: "image/png",
            },
          },
        },
      },
    });

    await app.jobHandlers.runGarbageCollection();

    const after = await prisma.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
    expect(after.status).toBe("uploaded");

    await app.close();
  });

  it("orphans an attachment whose diagram no longer references it (Phase 1)", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    await pointStorageAtTempDir(app);

    const user = await createUser(app, "diagram-stale@example.com");

    const diagram = await prisma.diagram.create({
      data: {
        userId: user.id,
        title: "stale diagram",
        scene: { elements: [], appState: {}, files: {} },
      },
    });

    // Old enough for Phase 1 orphan (>24h) but young enough that Phase 2
    // (deleteAfterMs default 7d, keyed on createdAt) does not delete in-run.
    const phase1Date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const attachment = await prisma.attachment.create({
      data: {
        userId: user.id,
        containerType: "diagram",
        containerId: diagram.id,
        originalName: "removed.png",
        mimeType: "image/png",
        sizeBytes: BigInt(1024),
        storageKey: `${user.id}/removed.png`,
        status: "uploaded",
        createdAt: phase1Date,
      },
    });

    await app.jobHandlers.runGarbageCollection();

    const after = await prisma.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
    expect(after.status).toBe("orphaned");

    await app.close();
  });

  it("sweeps untracked files past the grace period but keeps recent ones (Phase 3)", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const root = await pointStorageAtTempDir(app);

    const user = await createUser(app, "phase3@example.com");

    // Untracked + old → should be swept
    const untrackedOld = `${user.id}/untracked-old.bin`;
    await writeOrphanFile(root, untrackedOld, oldDate);

    // Untracked + recent → inside grace period, keep
    const untrackedFresh = `${user.id}/untracked-fresh.bin`;
    await writeOrphanFile(root, untrackedFresh, new Date());

    // Tracked by a real DB row → never touched
    const trackedKey = `${user.id}/tracked.bin`;
    await writeOrphanFile(root, trackedKey, oldDate);
    await prisma.attachment.create({
      data: {
        userId: user.id,
        containerType: "note",
        containerId: "c",
        originalName: "tracked.bin",
        mimeType: "application/octet-stream",
        sizeBytes: BigInt(8),
        storageKey: trackedKey,
        status: "uploaded",
      },
    });

    await app.jobHandlers.runGarbageCollection();

    await expect(stat(join(root, untrackedOld))).rejects.toThrow(); // deleted
    await expect(stat(join(root, untrackedFresh))).resolves.toMatchObject({}); // kept
    await expect(stat(join(root, trackedKey))).resolves.toMatchObject({}); // kept

    await app.close();
  });

  it("prunes pre-existing empty directories that no sweep touched this run", async () => {
    const { app } = await createTestApp();
    await resetDatabase(app);
    const root = await pointStorageAtTempDir(app);

    // Empty directories left over from prior runs
    await mkdir(join(root, "user-a", "nested", "deep"), { recursive: true });
    await mkdir(join(root, "user-b"), { recursive: true });

    await app.jobHandlers.runGarbageCollection();

    await expect(stat(join(root, "user-a"))).rejects.toThrow();
    await expect(stat(join(root, "user-b"))).rejects.toThrow();
    await expect(stat(root)).resolves.toMatchObject({}); // root preserved

    await app.close();
  });

  it("leaves non-empty directories alone during the empty-dir prune", async () => {
    const { app } = await createTestApp();
    await resetDatabase(app);
    const root = await pointStorageAtTempDir(app);

    const user = await createUser(app, "keep-dir@example.com");

    // A fresh (within grace period) untracked file — sweep skips it, dir must survive
    const liveKey = `${user.id}/live.bin`;
    await writeOrphanFile(root, liveKey, new Date());

    await app.jobHandlers.runGarbageCollection();

    await expect(stat(join(root, liveKey))).resolves.toMatchObject({});
    await expect(stat(join(root, user.id))).resolves.toMatchObject({});

    await app.close();
  });

  it("prunes empty ancestor directories after sweeping the last file in them", async () => {
    const { app } = await createTestApp();
    await resetDatabase(app);
    const root = await pointStorageAtTempDir(app);

    const user = await createUser(app, "prune@example.com");

    // Only file in a nested path, with an old mtime so the sweep touches it
    const lonely = `${user.id}/nested/deep/only.bin`;
    await writeOrphanFile(root, lonely, oldDate);

    await app.jobHandlers.runGarbageCollection();

    await expect(stat(join(root, lonely))).rejects.toThrow(); // file gone
    await expect(stat(join(root, user.id, "nested", "deep"))).rejects.toThrow(); // pruned
    await expect(stat(join(root, user.id, "nested"))).rejects.toThrow(); // pruned
    await expect(stat(join(root, user.id))).rejects.toThrow(); // pruned
    await expect(stat(root)).resolves.toMatchObject({}); // root itself preserved

    await app.close();
  });
});
