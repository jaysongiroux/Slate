import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AiConfig } from "@prisma/client";
import { JobsService } from "../jobs/jobs.service";
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

export type UpsertAiConfigResult = {
  config: AiConfig;
  embeddingModelOrProviderChanged: boolean;
  /** True when chat provider/model/endpoint/key identity changed — active chat streams should stop. */
  chatStreamingConfigChanged: boolean;
};

@Injectable()
export class AiConfigService {
  private readonly logger = new Logger(AiConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jobsService: JobsService,
  ) {}

  private get encryptionKey(): string {
    return this.config.get<string>("AI_ENCRYPTION_KEY", "local-dev-ai-key");
  }

  async getConfig(userId: string) {
    return this.prisma.aiConfig.findUnique({ where: { userId } });
  }

  async upsertConfig(userId: string, input: AiConfigInput): Promise<UpsertAiConfigResult> {
    const existing = await this.prisma.aiConfig.findUnique({ where: { userId } });

    const embeddingModelOrProviderChanged =
      existing !== null &&
      (input.embeddingModel !== undefined || input.embeddingProvider !== undefined) &&
      (input.embeddingModel !== existing.embeddingModel ||
        input.embeddingProvider !== existing.embeddingProvider);

    const strEq = (a: string | null | undefined, b: string | null | undefined) =>
      (a ?? "").trim() === (b ?? "").trim();

    const chatStreamingConfigChanged =
      existing !== null &&
      ((input.chatProvider !== undefined && input.chatProvider !== existing.chatProvider) ||
        (input.chatModel !== undefined && input.chatModel !== existing.chatModel) ||
        (input.chatEndpoint !== undefined &&
          !strEq(input.chatEndpoint ?? null, existing.chatEndpoint)) ||
        (input.chatApiKey != null && String(input.chatApiKey).trim() !== ""));

    if (embeddingModelOrProviderChanged) {
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
        input.embeddingApiKey != null ? this.encryptKey(input.embeddingApiKey) : null;
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
      data.chatApiKey = input.chatApiKey != null ? this.encryptKey(input.chatApiKey) : null;
    }

    const saved = await this.prisma.aiConfig.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });

    if (embeddingModelOrProviderChanged) {
      try {
        await this.jobsService.enqueue("embedding-batch", { userId });
      } catch (error) {
        this.logger.error(
          `Failed to enqueue embedding-batch after embedding config change for user ${userId}: ${error}`,
        );
      }
    }

    return {
      config: saved,
      embeddingModelOrProviderChanged,
      chatStreamingConfigChanged,
    };
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
