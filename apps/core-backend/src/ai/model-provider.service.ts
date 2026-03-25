import { Injectable } from "@nestjs/common";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Embeddings } from "@langchain/core/embeddings";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { OllamaEmbeddings } from "@langchain/ollama";
import { AiConfigService } from "./ai-config.service";
import { StreamingChatOllama } from "./streaming-chat-ollama";

interface ModelCache {
  chatModel?: BaseChatModel;
  embeddingModel?: Embeddings;
}

@Injectable()
export class ModelProviderService {
  private readonly cache = new Map<string, ModelCache>();

  constructor(private readonly aiConfigService: AiConfigService) {}

  invalidateCache(userId: string): void {
    this.cache.delete(userId);
  }

  async getChatModel(userId: string): Promise<BaseChatModel> {
    const cached = this.cache.get(userId);
    if (cached?.chatModel) {
      return cached.chatModel;
    }

    const config = await this.aiConfigService.getConfig(userId);

    if (!config?.chatProvider || !config?.chatModel) {
      throw new Error("Chat model not configured");
    }

    const apiKey = this.aiConfigService.decryptIfPresent(config.chatApiKey);
    let chatModel: BaseChatModel;

    switch (config.chatProvider) {
      case "OPENAI":
        chatModel = new (ChatOpenAI as any)({
          model: config.chatModel,
          apiKey: apiKey ?? undefined,
          streaming: true,
        });
        break;

      case "ANTHROPIC":
        chatModel = new (ChatAnthropic as any)({
          model: config.chatModel,
          apiKey: apiKey ?? undefined,
          streaming: true,
        });
        break;

      case "OLLAMA":
        chatModel = new StreamingChatOllama({
          model: config.chatModel,
          baseUrl: config.chatEndpoint ?? "http://localhost:11434",
          streaming: true,
        }) as BaseChatModel;
        break;

      case "OPENAI_COMPATIBLE":
        chatModel = new (ChatOpenAI as any)({
          model: config.chatModel,
          apiKey: apiKey ?? "not-needed",
          configuration: {
            baseURL: config.chatEndpoint ?? undefined,
          },
          streaming: true,
        });
        break;

      default:
        throw new Error(`Unsupported chat provider: ${config.chatProvider}`);
    }

    const entry = this.cache.get(userId) ?? {};
    entry.chatModel = chatModel;
    this.cache.set(userId, entry);

    return chatModel;
  }

  /** Returns null when embeddings are missing or cannot be built (chat still runs without vector search). */
  async getEmbeddingModelOrNull(userId: string): Promise<Embeddings | null> {
    try {
      return await this.getEmbeddingModel(userId);
    } catch {
      return null;
    }
  }

  async getEmbeddingModel(userId: string): Promise<Embeddings> {
    const cached = this.cache.get(userId);
    if (cached?.embeddingModel) {
      return cached.embeddingModel;
    }

    const config = await this.aiConfigService.getConfig(userId);

    if (!config?.embeddingProvider || !config?.embeddingModel) {
      throw new Error("Embedding model not configured");
    }

    const apiKey = this.aiConfigService.decryptIfPresent(config.embeddingApiKey);
    let embeddingModel: Embeddings;

    switch (config.embeddingProvider) {
      case "OPENAI":
        embeddingModel = new OpenAIEmbeddings({
          model: config.embeddingModel,
          apiKey: apiKey ?? undefined,
        });
        break;

      case "ANTHROPIC":
        throw new Error("Unsupported embedding provider: ANTHROPIC");

      case "OLLAMA":
        embeddingModel = new OllamaEmbeddings({
          model: config.embeddingModel,
          baseUrl: config.embeddingEndpoint ?? "http://localhost:11434",
        });
        break;

      case "OPENAI_COMPATIBLE":
        embeddingModel = new OpenAIEmbeddings({
          model: config.embeddingModel,
          apiKey: apiKey ?? "not-needed",
          configuration: {
            baseURL: config.embeddingEndpoint ?? undefined,
          },
        });
        break;

      default:
        throw new Error(`Unsupported embedding provider: ${config.embeddingProvider}`);
    }

    const entry = this.cache.get(userId) ?? {};
    entry.embeddingModel = embeddingModel;
    this.cache.set(userId, entry);

    return embeddingModel;
  }
}
