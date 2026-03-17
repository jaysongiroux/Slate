import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Readable } from "node:stream";
import { PrismaService } from "../prisma/prisma.service";
import { JobsService } from "../jobs/jobs.service";
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
    private readonly jobs: JobsService,
  ) {}

  async register(payload: {
    workspaceId: string;
    documentId: string;
    originalName: string;
    mimeType: string;
    sizeBytes: string | number;
  }) {
    const attachment = await this.prisma.attachment.create({
      data: {
        workspaceId: payload.workspaceId,
        documentId: payload.documentId,
        originalName: payload.originalName,
        mimeType: payload.mimeType,
        sizeBytes: BigInt(payload.sizeBytes),
        storageKey: `${payload.workspaceId}/${crypto.randomUUID()}-${payload.originalName}`,
      },
    });

    return {
      id: attachment.id,
      documentId: attachment.documentId,
      workspaceId: attachment.workspaceId,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: Number(attachment.sizeBytes),
      storageKey: attachment.storageKey,
    };
  }

  async registerAndStore(input: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    workspaceId: string;
    documentId: string;
  }) {
    const storageKey = `${input.workspaceId}/${crypto.randomUUID()}-${input.originalName}`;

    const attachment = await this.prisma.attachment.create({
      data: {
        workspaceId: input.workspaceId,
        documentId: input.documentId,
        originalName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        storageKey,
        status: "uploaded",
      },
    });

    await this.storage.store(storageKey, input.buffer, input.mimeType);

    if (IMAGE_MIME_TYPES.has(input.mimeType.toLowerCase())) {
      await this.jobs.enqueue("image-process", { attachmentId: attachment.id });
    }

    return attachment;
  }

  async getContentStream(
    attachmentId: string,
    workspaceId: string,
  ): Promise<{ stream: Readable; mimeType: string; filename: string }> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment || attachment.workspaceId !== workspaceId) {
      throw new NotFoundException("Attachment not found");
    }

    const key =
      attachment.status === "processed" && attachment.processedKey
        ? attachment.processedKey
        : attachment.storageKey;

    const mimeType =
      attachment.status === "processed" && attachment.processedKey
        ? "image/webp"
        : attachment.mimeType;

    const stream = await this.storage.retrieve(key);

    return {
      stream,
      mimeType,
      filename: attachment.originalName,
    };
  }
}
