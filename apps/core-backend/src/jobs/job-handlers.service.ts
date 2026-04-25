import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@slate/server-db";
import type { EmbeddingService } from "../ai/embedding.service";
import type { StorageService } from "../storage/storage.service";
import type { AppConfig } from "../lib/types";
import type { JobsService } from "./jobs.service";
import type { MaterializeService } from "../materialization/materialize.service";
import type { NoteGraphService } from "../graph/note-graph.service";

export class JobHandlersService {
  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaClient,
    private readonly storage: StorageService,
    private readonly embeddingService: EmbeddingService,
    private readonly materializeService: MaterializeService,
    private readonly config: AppConfig,
    private readonly noteGraphService: NoteGraphService,
    private readonly log: FastifyBaseLogger,
  ) {}

  async init() {
    await this.jobs.registerWorker("attachment-gc", async () => {
      await this.runGarbageCollection();
    });

    await this.jobs.registerWorker("storage-migrate", async (job) => {
      const { attachmentId, fromType, toType } = job.data as {
        attachmentId: string;
        fromType: string;
        toType: string;
      };
      await this.migrateAttachment(attachmentId, fromType, toType);
    });

    await this.jobs.registerWorker("embedding-cron", async () => {
      await this.embeddingService.processUnembeddedDocuments(50, 60);
    });

    await this.jobs.registerWorker("embedding-process", async () => {
      await this.embeddingService.processUnembeddedDocuments(50, 60);
    });

    // User-triggered rescan (AiService.TriggerEmbedding) enqueues this queue; it had no worker before.
    await this.jobs.registerWorker("embedding-batch", async (job) => {
      const jobId = job.id != null ? String(job.id) : "unknown";
      this.log.info({ jobId }, "embedding-batch: active (picked up job)");

      const userId =
        job.data && typeof (job.data as { userId?: string }).userId === "string"
          ? (job.data as { userId: string }).userId
          : undefined;
      if (!userId) {
        this.log.warn({ jobId, data: job.data }, "embedding-batch: missing userId, skipping");
        return;
      }

      // Snapshot config at job start
      const initialConfig = await this.prisma.aiConfig.findUnique({
        where: { userId },
        select: { embeddingProvider: true, embeddingModel: true },
      });
      if (!initialConfig?.embeddingModel || !initialConfig?.embeddingProvider) {
        this.log.info({ jobId, userId }, "embedding-batch: no embedding config for user, skipping");
        return;
      }

      this.log.info({ jobId, userId }, "embedding-batch: starting");
      const batchSize = 50;
      const maxBatches = 500;
      let lastProcessed = 0;
      for (let i = 0; i < maxBatches; i++) {
        // Check for config staleness before each batch
        if (i > 0) {
          const currentConfig = await this.prisma.aiConfig.findUnique({
            where: { userId },
            select: { embeddingProvider: true, embeddingModel: true },
          });
          if (
            currentConfig?.embeddingProvider !== initialConfig.embeddingProvider ||
            currentConfig?.embeddingModel !== initialConfig.embeddingModel
          ) {
            this.log.info(
              { jobId, userId, batch: i },
              "embedding-batch: config changed, stopping stale job",
            );
            return;
          }
        }

        if (i === 0 || i % 10 === 0) {
          this.log.info({ jobId, userId, batch: i }, "embedding-batch: running batch");
        }
        const n = await this.embeddingService.processUnembeddedDocuments(batchSize);
        lastProcessed = n;
        if (i === 0 || i % 10 === 0 || n < batchSize) {
          this.log.info(
            { jobId, userId, batch: i, processedThisRound: n },
            "embedding-batch: batch finished",
          );
        }
        if (n < batchSize) {
          break;
        }
      }

      this.log.info(
        { jobId, userId, lastProcessed },
        "embedding-batch: batch loop finished, enqueue graph if eligible",
      );
      await this.noteGraphService.enqueueRebuildIfEligible(userId);
      this.log.info({ jobId, userId }, "embedding-batch: job complete");
    });

    await this.jobs.registerWorker("note-graph-rebuild", async (job) => {
      const userId =
        job.data && typeof (job.data as { userId?: string }).userId === "string"
          ? (job.data as { userId: string }).userId
          : undefined;
      if (!userId) return;
      await this.noteGraphService.rebuildGraphForUser(userId);
    });

    await this.jobs.registerWorker("materialize", async (job) => {
      const { documentId, userId } = job.data as { documentId: string; userId: string };
      const doc = await this.prisma.document.findFirst({
        where: { id: documentId, userId },
        select: { id: true, content: true, markdown: true },
      });

      if (!doc) {
        this.log.warn(`materialize: document ${documentId} not found, skipping`);
        return;
      }

      const newMarkdown = this.materializeService.toMarkdown(
        doc.content as Record<string, unknown>,
      );

      if (newMarkdown !== doc.markdown) {
        await this.prisma.document.update({
          where: { id: documentId },
          data: { markdown: newMarkdown, embedded: false },
        });
        this.log.info(`Materialized markdown for ${documentId}, marked for re-embedding`);
      }
    });

    // search-index worker kept as no-op to drain any previously-queued jobs
    await this.jobs.registerWorker("search-index", async () => {});

    await this.jobs.schedule("attachment-gc", "0 3 * * *");
    await this.jobs.schedule(
      "embedding-cron",
      this.config.get("EMBEDDING_CRON_INTERVAL", "*/10 * * * *"),
    );
  }

  async runGarbageCollection(options?: {
    orphanAfterMs?: number;
    deleteAfterMs?: number;
    sweepAfterMs?: number;
  }) {
    this.log.info("Starting attachment garbage collection");

    const orphanAfterMs = options?.orphanAfterMs ?? 24 * 60 * 60 * 1000;
    const deleteAfterMs = options?.deleteAfterMs ?? 7 * 24 * 60 * 60 * 1000;
    const sweepAfterMs = options?.sweepAfterMs ?? 60 * 60 * 1000;

    // Phase 0: Reap stale "pending" saga attempts (process crashed mid-upload).
    const pendingCutoff = new Date(Date.now() - sweepAfterMs);
    const stalePending = await this.prisma.attachment.findMany({
      where: { status: "pending", createdAt: { lt: pendingCutoff } },
      select: { id: true, storageKey: true, processedKey: true },
    });
    let pendingCleaned = 0;
    for (const attachment of stalePending) {
      try {
        await this.storage.remove(attachment.storageKey).catch(() => {});
        if (attachment.processedKey) {
          await this.storage.remove(attachment.processedKey).catch(() => {});
        }
        await this.prisma.attachment.delete({ where: { id: attachment.id } });
        pendingCleaned++;
      } catch (error) {
        this.log.error(`Failed to clean pending attachment ${attachment.id}: ${error}`);
      }
    }

    // Phase 1: Mark unreferenced uploaded/processed attachments as orphaned.
    const cutoff = new Date(Date.now() - orphanAfterMs);
    const candidates = await this.prisma.attachment.findMany({
      where: {
        createdAt: { lt: cutoff },
        status: { in: ["uploaded", "processed"] },
      },
      select: { id: true, userId: true, storageKey: true, processedKey: true, status: true },
    });

    let markedOrphan = 0;
    for (const attachment of candidates) {
      const contentUrl = `/api/attachments/${attachment.id}/content`;
      const referenced = await this.prisma.document.findFirst({
        where: {
          userId: attachment.userId,
          deleted: false,
          markdown: { contains: contentUrl },
        },
        select: { id: true },
      });

      if (!referenced) {
        await this.prisma.attachment.update({
          where: { id: attachment.id },
          data: { status: "orphaned" },
        });
        markedOrphan++;
        this.log.debug(`Marked attachment ${attachment.id} as orphaned`);
      }
    }

    // Phase 2: Delete attachments orphaned for the configured duration.
    const orphanCutoff = new Date(Date.now() - deleteAfterMs);
    const orphaned = await this.prisma.attachment.findMany({
      where: {
        status: "orphaned",
        createdAt: { lt: orphanCutoff },
      },
    });

    let deletedOrphans = 0;
    for (const attachment of orphaned) {
      try {
        await this.storage.remove(attachment.storageKey);
        if (attachment.processedKey) {
          await this.storage.remove(attachment.processedKey);
        }
        await this.prisma.attachment.delete({ where: { id: attachment.id } });
        deletedOrphans++;
        this.log.info(`Deleted orphaned attachment ${attachment.id}`);
      } catch (error) {
        this.log.error(`Failed to delete orphaned attachment ${attachment.id}: ${error}`);
      }
    }

    // Phase 3: Storage sweep — delete files with no DB row, older than the grace period.
    const sweepCutoffMs = Date.now() - sweepAfterMs;
    let sweepDeleted = 0;
    try {
      const objects = await this.storage.listKeys("");
      const knownRows = await this.prisma.attachment.findMany({
        select: { storageKey: true, processedKey: true },
      });
      const knownKeys = new Set<string>();
      for (const row of knownRows) {
        knownKeys.add(row.storageKey);
        if (row.processedKey) knownKeys.add(row.processedKey);
      }

      for (const obj of objects) {
        if (knownKeys.has(obj.key)) continue;
        if (obj.mtime.getTime() >= sweepCutoffMs) continue;
        try {
          await this.storage.remove(obj.key);
          sweepDeleted++;
          this.log.info(`Swept untracked storage key ${obj.key}`);
        } catch (error) {
          this.log.error(`Failed to sweep storage key ${obj.key}: ${error}`);
        }
      }
    } catch (error) {
      this.log.error(`Storage sweep failed: ${error}`);
    }

    // Phase 4: Prune any empty directories left behind in storage.
    let dirsPruned = 0;
    try {
      dirsPruned = await this.storage.pruneEmptyDirectories();
    } catch (error) {
      this.log.error(`Empty-directory prune failed: ${error}`);
    }

    this.log.info(
      `GC complete: ${pendingCleaned} stale pending cleaned, ${candidates.length} checked, ${markedOrphan} newly orphaned, ${deletedOrphans} orphans deleted, ${sweepDeleted} untracked files swept, ${dirsPruned} empty directories pruned`,
    );
  }

  private async migrateAttachment(attachmentId: string, fromType: string, toType: string) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment) return;

    try {
      await this.prisma.attachment.update({
        where: { id: attachmentId },
        data: { status: "migrating" },
      });

      const sourceBackend = await this.storage.getBackendForType(fromType);
      const targetBackend = await this.storage.getBackendForType(toType);

      // Migrate main file
      const rawStream = await sourceBackend.get(attachment.storageKey);
      const chunks: Buffer[] = [];
      for await (const chunk of rawStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      await targetBackend.put(attachment.storageKey, Buffer.concat(chunks), attachment.mimeType);

      // Migrate processed file if exists
      if (attachment.processedKey) {
        const procStream = await sourceBackend.get(attachment.processedKey);
        const procChunks: Buffer[] = [];
        for await (const chunk of procStream) {
          procChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        await targetBackend.put(attachment.processedKey, Buffer.concat(procChunks), "image/webp");
      }

      // Verify
      const mainExists = await targetBackend.exists(attachment.storageKey);
      const procExists = attachment.processedKey
        ? await targetBackend.exists(attachment.processedKey)
        : true;

      if (!mainExists || !procExists) {
        throw new Error("Verification failed after migration");
      }

      // Delete from source
      await sourceBackend.delete(attachment.storageKey);
      if (attachment.processedKey) {
        await sourceBackend.delete(attachment.processedKey);
      }

      await this.prisma.attachment.update({
        where: { id: attachmentId },
        data: { status: attachment.processedKey ? "processed" : "uploaded" },
      });

      this.log.info(`Migrated attachment ${attachmentId} from ${fromType} to ${toType}`);
    } catch (error) {
      this.log.error(`Failed to migrate attachment ${attachmentId}: ${error}`);
      // Restore previous status
      await this.prisma.attachment.update({
        where: { id: attachmentId },
        data: { status: attachment.processedKey ? "processed" : "uploaded" },
      });
    }
  }
}
