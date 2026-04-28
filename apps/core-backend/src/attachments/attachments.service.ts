import pino from "pino";
import type { PrismaClient } from "@slate/server-db";
import { notFound } from "../lib/errors";
import { createHash, randomUUID } from "node:crypto";
import heicConvert from "heic-convert";
import sharp from "sharp";
import { Readable } from "node:stream";
import { StorageService } from "../storage/storage.service";

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/bmp",
]);

export class AttachmentsService {
  private readonly logger = pino({ name: "AttachmentsService" });

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageService,
  ) {}

  async register(payload: {
    userId: string;
    containerType: "note" | "diagram";
    containerId: string;
    originalName: string;
    mimeType: string;
    sizeBytes: string | number;
  }) {
    const attachment = await this.prisma.attachment.create({
      data: {
        userId: payload.userId,
        containerType: payload.containerType,
        containerId: payload.containerId,
        originalName: payload.originalName,
        mimeType: payload.mimeType,
        sizeBytes: BigInt(payload.sizeBytes),
        storageKey: `${payload.userId}/${randomUUID()}-${payload.originalName}`,
      },
    });

    return {
      id: attachment.id,
      containerType: attachment.containerType,
      containerId: attachment.containerId,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: Number(attachment.sizeBytes),
      storageKey: attachment.storageKey,
    };
  }

  private async convertToWebp(buffer: Buffer, mimeType: string): Promise<Buffer> {
    let input = buffer;
    // sharp's libheif doesn't include HEVC codec; pre-convert HEIC to JPEG
    if (mimeType === "image/heic" || mimeType === "image/heif") {
      const jpegBuffer = await heicConvert({
        buffer: new Uint8Array(input) as unknown as ArrayBuffer,
        format: "JPEG",
        quality: 0.9,
      });
      input = Buffer.from(jpegBuffer);
    }
    return sharp(input)
      .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  }

  async registerAndStore(input: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    userId: string;
    containerType: "note" | "diagram";
    containerId: string;
  }) {
    const isImage = IMAGE_MIME_TYPES.has(input.mimeType.toLowerCase());

    // Compute hash of the raw upload for deduplication
    const contentHash = createHash("sha256").update(input.buffer).digest("hex");

    // Check for existing attachment with same hash in this workspace
    const existing = await this.prisma.attachment.findFirst({
      where: {
        userId: input.userId,
        hash: contentHash,
        status: { in: ["uploaded", "processed"] },
      },
    });

    if (existing) {
      this.logger.info(`Deduplicated ${input.originalName} → existing attachment ${existing.id}`);
      return existing;
    }

    let fileBuffer = input.buffer;
    let mimeType = input.mimeType;
    let storageKey = `${input.userId}/${randomUUID()}-${input.originalName}`;
    let finalStatus = "uploaded";
    let convertedBytes: number | null = null;

    if (isImage) {
      const webpBuffer = await this.convertToWebp(input.buffer, input.mimeType);
      storageKey = storageKey.replace(/\.[^.]+$/, "") + ".webp";
      fileBuffer = webpBuffer;
      mimeType = "image/webp";
      finalStatus = "processed";
      convertedBytes = webpBuffer.length;
    }

    // Saga: create the DB row first as "pending" so a crash between steps
    // leaves recoverable state (GC Phase 0 reaps stale pending rows).
    const attachment = await this.prisma.attachment.create({
      data: {
        userId: input.userId,
        containerType: input.containerType,
        containerId: input.containerId,
        originalName: input.originalName,
        mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        storageKey,
        status: "pending",
        hash: contentHash,
      },
    });

    try {
      await this.storage.store(storageKey, fileBuffer, mimeType);
    } catch (err) {
      await this.prisma.attachment.delete({ where: { id: attachment.id } }).catch((delErr) => {
        this.logger.error(
          `Saga rollback (pending row ${attachment.id}) failed after storage.store error: ${delErr}`,
        );
      });
      throw err;
    }

    if (convertedBytes !== null) {
      this.logger.info(
        `Converted ${input.originalName}: ${input.buffer.length} → ${convertedBytes} bytes`,
      );
    }

    try {
      return await this.prisma.attachment.update({
        where: { id: attachment.id },
        data: { status: finalStatus },
      });
    } catch (err) {
      await this.storage.remove(storageKey).catch((remErr) => {
        this.logger.error(
          `Saga rollback (file ${storageKey}) failed after status-update error: ${remErr}`,
        );
      });
      await this.prisma.attachment.delete({ where: { id: attachment.id } }).catch((delErr) => {
        this.logger.error(
          `Saga rollback (pending row ${attachment.id}) failed after status-update error: ${delErr}`,
        );
      });
      throw err;
    }
  }

  async listForUser(userId: string) {
    const rows = await this.prisma.attachment.findMany({
      where: {
        userId,
        status: { in: ["uploaded", "processed"] },
      },
      select: {
        id: true,
        containerType: true,
        containerId: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
      },
      orderBy: { id: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      containerType: r.containerType,
      containerId: r.containerId,
      originalName: r.originalName,
      mimeType: r.mimeType,
      sizeBytes: Number(r.sizeBytes),
    }));
  }

  async bulkImportOne(input: {
    id: string;
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    userId: string;
    containerType: "note" | "diagram";
    containerId: string;
  }) {
    const incumbent = await this.prisma.attachment.findUnique({ where: { id: input.id } });
    if (incumbent && incumbent.userId !== input.userId) {
      const err = new Error("Attachment id is owned by another user") as Error & {
        status: number;
      };
      err.status = 409;
      throw err;
    }

    const storageKey =
      incumbent?.storageKey ?? `${input.userId}/${input.id}-${input.originalName}`;
    await this.storage.store(storageKey, input.buffer, input.mimeType);

    if (incumbent) {
      return this.prisma.attachment.update({
        where: { id: input.id },
        data: {
          containerType: input.containerType,
          containerId: input.containerId,
          originalName: input.originalName,
          mimeType: input.mimeType,
          sizeBytes: BigInt(input.sizeBytes),
          storageKey,
          status: "uploaded",
          processedKey: null,
          hash: null,
        },
      });
    }

    return this.prisma.attachment.create({
      data: {
        id: input.id,
        userId: input.userId,
        containerType: input.containerType,
        containerId: input.containerId,
        originalName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        storageKey,
        status: "uploaded",
      },
    });
  }

  async getContentStream(
    attachmentId: string,
    userId: string,
  ): Promise<{ stream: Readable; mimeType: string; filename: string }> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment || attachment.userId !== userId) {
      throw notFound("Attachment not found");
    }

    const key = attachment.processedKey ?? attachment.storageKey;
    const mimeType = attachment.processedKey ? "image/webp" : attachment.mimeType;
    const stream = await this.storage.retrieve(key);

    return {
      stream,
      mimeType,
      filename: attachment.originalName,
    };
  }
}
