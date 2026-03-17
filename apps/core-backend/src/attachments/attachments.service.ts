import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

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
        storageKey: `${payload.workspaceId}/${crypto.randomUUID()}-${payload.originalName}`
      }
    });

    return {
      id: attachment.id,
      documentId: attachment.documentId,
      workspaceId: attachment.workspaceId,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: Number(attachment.sizeBytes),
      storageKey: attachment.storageKey
    };
  }
}

