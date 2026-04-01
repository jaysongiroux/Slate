import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmbeddingService } from "../ai/embedding.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { JobsService } from "./jobs.service";

@Injectable()
export class JobHandlersService implements OnModuleInit {
  private readonly logger = new Logger(JobHandlersService.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly embeddingService: EmbeddingService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
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
      await this.embeddingService.processUnembeddedDocuments();
    });

    await this.jobs.registerWorker("embedding-process", async () => {
      await this.embeddingService.processUnembeddedDocuments(50);
    });

    // User-triggered rescan (AiService.TriggerEmbedding) enqueues this queue; it had no worker before.
    await this.jobs.registerWorker("embedding-batch", async (job) => {
      const userId =
        job.data && typeof (job.data as { userId?: string }).userId === "string"
          ? (job.data as { userId: string }).userId
          : undefined;
      if (userId) {
        this.logger.log(`embedding-batch job for user ${userId}`);
      }
      const batchSize = 50;
      const maxBatches = 500;
      for (let i = 0; i < maxBatches; i++) {
        const n = await this.embeddingService.processUnembeddedDocuments(batchSize);
        if (n < batchSize) {
          break;
        }
      }
    });

    await this.jobs.schedule("attachment-gc", "0 3 * * *");
    await this.jobs.schedule(
      "embedding-cron",
      this.config.get("EMBEDDING_CRON_INTERVAL", "0 */2 * * *"),
    );
  }

  async runGarbageCollection(options?: { orphanAfterMs?: number; deleteAfterMs?: number }) {
    this.logger.log("Starting attachment garbage collection");

    const orphanAfterMs = options?.orphanAfterMs ?? 24 * 60 * 60 * 1000;
    const deleteAfterMs = options?.deleteAfterMs ?? 7 * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - orphanAfterMs);

    // Find attachments older than 24h that are uploaded or processed
    const candidates = await this.prisma.attachment.findMany({
      where: {
        createdAt: { lt: cutoff },
        status: { in: ["uploaded", "processed"] },
      },
      select: { id: true, userId: true, storageKey: true, processedKey: true, status: true },
    });

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
        this.logger.debug(`Marked attachment ${attachment.id} as orphaned`);
      }
    }

    // Delete attachments orphaned for the configured duration
    const orphanCutoff = new Date(Date.now() - deleteAfterMs);
    const orphaned = await this.prisma.attachment.findMany({
      where: {
        status: "orphaned",
        createdAt: { lt: orphanCutoff },
      },
    });

    for (const attachment of orphaned) {
      try {
        await this.storage.remove(attachment.storageKey);
        if (attachment.processedKey) {
          await this.storage.remove(attachment.processedKey);
        }
        await this.prisma.attachment.delete({ where: { id: attachment.id } });
        this.logger.log(`Deleted orphaned attachment ${attachment.id}`);
      } catch (error) {
        this.logger.error(`Failed to delete orphaned attachment ${attachment.id}: ${error}`);
      }
    }

    this.logger.log(`GC complete: ${candidates.length} checked, ${orphaned.length} deleted`);
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

      this.logger.log(`Migrated attachment ${attachmentId} from ${fromType} to ${toType}`);
    } catch (error) {
      this.logger.error(`Failed to migrate attachment ${attachmentId}: ${error}`);
      // Restore previous status
      await this.prisma.attachment.update({
        where: { id: attachmentId },
        data: { status: attachment.processedKey ? "processed" : "uploaded" },
      });
    }
  }
}
