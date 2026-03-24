import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { decryptSecret, encryptSecret } from "./encryption.util";

export interface AiConfigInput {
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingEndpoint?: string | null;
  embeddingApiKey?: string | null;
  chatProvider?: string;
  chatModel?: string;
  chatEndpoint?: string | null;
  chatApiKey?: string | null;
}

@Injectable()
export class AiConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get encryptionKey(): string {
    return this.config.get<string>("AI_ENCRYPTION_KEY", "local-dev-ai-key");
  }

  async getConfig(userId: string) {
    return this.prisma.aiConfig.findUnique({ where: { userId } });
  }

  async upsertConfig(userId: string, input: AiConfigInput) {
    const existing = await this.prisma.aiConfig.findUnique({ where: { userId } });

    const embeddingModelChanged =
      existing !== null &&
      (input.embeddingModel !== undefined || input.embeddingProvider !== undefined) &&
      (input.embeddingModel !== existing.embeddingModel ||
        input.embeddingProvider !== existing.embeddingProvider);

    if (embeddingModelChanged) {
      await this.prisma.documentChunk.deleteMany({ where: { userId } });
      await this.prisma.document.updateMany({
        where: { userId },
        data: { embedded: false },
      });
    }

    const data: Record<string, unknown> = {};

    if (input.embeddingProvider !== undefined) {
      data.embeddingProvider = input.embeddingProvider;
    }
    if (input.embeddingModel !== undefined) {
      data.embeddingModel = input.embeddingModel;
    }
    if (input.embeddingEndpoint !== undefined) {
      data.embeddingEndpoint = input.embeddingEndpoint;
    }
    if (input.embeddingApiKey !== undefined) {
      data.embeddingApiKey =
        input.embeddingApiKey != null
          ? this.encryptKey(input.embeddingApiKey)
          : null;
    }
    if (input.chatProvider !== undefined) {
      data.chatProvider = input.chatProvider;
    }
    if (input.chatModel !== undefined) {
      data.chatModel = input.chatModel;
    }
    if (input.chatEndpoint !== undefined) {
      data.chatEndpoint = input.chatEndpoint;
    }
    if (input.chatApiKey !== undefined) {
      data.chatApiKey =
        input.chatApiKey != null ? this.encryptKey(input.chatApiKey) : null;
    }

    return this.prisma.aiConfig.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
  }

  decryptIfPresent(value: string | null | undefined): string | null {
    if (value == null) {
      return null;
    }
    return decryptSecret(value, this.encryptionKey);
  }

  encryptKey(key: string): string {
    return encryptSecret(key, this.encryptionKey);
  }
}
