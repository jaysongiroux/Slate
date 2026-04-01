import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import heicConvert from "heic-convert";
import sharp from "sharp";
import { Readable } from "node:stream";
import { PrismaService } from "../prisma/prisma.service";
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

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async register(payload: {
    documentId: string;
    originalName: string;
    mimeType: string;
    sizeBytes: string | number;
  }) {
    const document = await this.prisma.document.findUnique({
      where: { id: payload.documentId },
      select: { userId: true },
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    const attachment = await this.prisma.attachment.create({
      data: {
        userId: document.userId,
        documentId: payload.documentId,
        originalName: payload.originalName,
        mimeType: payload.mimeType,
        sizeBytes: BigInt(payload.sizeBytes),
        storageKey: `${document.userId}/${randomUUID()}-${payload.originalName}`,
      },
    });

    return {
      id: attachment.id,
      documentId: attachment.documentId,
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
    documentId: string;
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
      this.logger.log(`Deduplicated ${input.originalName} → existing attachment ${existing.id}`);
      return existing;
    }

    let fileBuffer = input.buffer;
    let mimeType = input.mimeType;
    let storageKey = `${input.userId}/${randomUUID()}-${input.originalName}`;
    let status = "uploaded";

    if (isImage) {
      const webpBuffer = await this.convertToWebp(input.buffer, input.mimeType);
      storageKey = storageKey.replace(/\.[^.]+$/, "") + ".webp";
      await this.storage.store(storageKey, webpBuffer, "image/webp");
      mimeType = "image/webp";
      status = "processed";
      this.logger.log(
        `Converted ${input.originalName}: ${input.buffer.length} → ${webpBuffer.length} bytes`,
      );
    } else {
      await this.storage.store(storageKey, fileBuffer, mimeType);
    }

    const attachment = await this.prisma.attachment.create({
      data: {
        userId: input.userId,
        documentId: input.documentId,
        originalName: input.originalName,
        mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        storageKey,
        status,
        hash: contentHash,
      },
    });

    return attachment;
  }

  async getContentStream(
    attachmentId: string,
    userId: string,
  ): Promise<{ stream: Readable; mimeType: string; filename: string }> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment || attachment.userId !== userId) {
      throw new NotFoundException("Attachment not found");
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
