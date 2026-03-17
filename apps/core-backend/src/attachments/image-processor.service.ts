import { Injectable, Logger } from "@nestjs/common";
import sharp from "sharp";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

@Injectable()
export class ImageProcessorService {
  private readonly logger = new Logger(ImageProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async processImage(attachmentId: string): Promise<void> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment) {
      this.logger.warn(`Attachment ${attachmentId} not found, skipping`);
      return;
    }

    if (attachment.status === "processed") {
      return;
    }

    try {
      const rawStream = await this.storage.retrieve(attachment.storageKey);
      const chunks: Buffer[] = [];
      for await (const chunk of rawStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const rawBuffer = Buffer.concat(chunks);

      const processedBuffer = await sharp(rawBuffer)
        .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      const processedKey = attachment.storageKey.replace(/\.[^.]+$/, "") + ".webp";

      await this.storage.store(processedKey, processedBuffer, "image/webp");

      await this.prisma.attachment.update({
        where: { id: attachmentId },
        data: {
          status: "processed",
          processedKey,
          mimeType: "image/webp",
        },
      });

      this.logger.log(`Processed image ${attachmentId}: ${rawBuffer.length} → ${processedBuffer.length} bytes`);
    } catch (error) {
      this.logger.error(`Failed to process image ${attachmentId}: ${error}`);
    }
  }
}
