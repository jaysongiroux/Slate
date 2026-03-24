import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { Metadata } from "@grpc/grpc-js";
import { Observable, Subject } from "rxjs";
import { AuthSessionService } from "../auth/auth-session.service";
import { AiConfigService } from "./ai-config.service";
import { ConversationService } from "./conversation.service";
import { AgentService } from "./agent.service";
import { EmbeddingService } from "./embedding.service";
import { PrismaService } from "../prisma/prisma.service";
import { JobsService } from "../jobs/jobs.service";

function maskConfig(config: any) {
  return {
    embeddingProvider: config?.embeddingProvider ?? undefined,
    embeddingModel: config?.embeddingModel ?? undefined,
    embeddingEndpoint: config?.embeddingEndpoint ?? undefined,
    hasEmbeddingApiKey: !!config?.embeddingApiKey,
    chatProvider: config?.chatProvider ?? undefined,
    chatModel: config?.chatModel ?? undefined,
    chatEndpoint: config?.chatEndpoint ?? undefined,
    hasChatApiKey: !!config?.chatApiKey,
  };
}

@Controller()
export class AiController {
  constructor(
    private readonly authSessionService: AuthSessionService,
    private readonly aiConfigService: AiConfigService,
    private readonly conversationService: ConversationService,
    private readonly agentService: AgentService,
    private readonly embeddingService: EmbeddingService,
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsService,
  ) {}

  @GrpcMethod("AiService", "GetAiConfig")
  async getAiConfig(_payload: unknown, metadata: Metadata) {
    const principal = await this.authSessionService.requireSession(metadata);
    const config = await this.aiConfigService.getConfig(principal.userId);
    return maskConfig(config);
  }

  @GrpcMethod("AiService", "UpdateAiConfig")
  async updateAiConfig(
    payload: {
      embeddingProvider?: string;
      embeddingModel?: string;
      embeddingEndpoint?: string;
      embeddingApiKey?: string;
      chatProvider?: string;
      chatModel?: string;
      chatEndpoint?: string;
      chatApiKey?: string;
    },
    metadata: Metadata,
  ) {
    const principal = await this.authSessionService.requireSession(metadata);
    const config = await this.aiConfigService.upsertConfig(principal.userId, payload);
    return maskConfig(config);
  }

  @GrpcMethod("AiService", "CreateConversation")
  async createConversation(_payload: unknown, metadata: Metadata) {
    const principal = await this.authSessionService.requireSession(metadata);
    const conversation = await this.conversationService.createConversation(principal.userId);
    return {
      id: conversation.id,
      title: conversation.title ?? undefined,
      messageCount: 0,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  @GrpcMethod("AiService", "ListConversations")
  async listConversations(_payload: unknown, metadata: Metadata) {
    const principal = await this.authSessionService.requireSession(metadata);
    const conversations = await this.conversationService.listConversations(principal.userId);
    return {
      conversations: conversations.map((c: any) => ({
        id: c.id,
        title: c.title ?? undefined,
        messageCount: c._count?.messages ?? 0,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    };
  }

  @GrpcMethod("AiService", "DeleteConversation")
  async deleteConversation(payload: { id: string }, metadata: Metadata) {
    const principal = await this.authSessionService.requireSession(metadata);
    await this.conversationService.deleteConversation(payload.id, principal.userId);
    return {};
  }

  @GrpcMethod("AiService", "GetConversationMessages")
  async getConversationMessages(
    payload: { conversationId: string },
    metadata: Metadata,
  ) {
    const principal = await this.authSessionService.requireSession(metadata);
    const messages = await this.conversationService.getMessages(
      payload.conversationId,
      principal.userId,
    );
    return {
      messages: messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  @GrpcMethod("AiService", "SendMessage")
  sendMessage(
    payload: { conversationId: string; content: string },
    metadata: Metadata,
  ): Observable<any> {
    const subject = new Subject<any>();

    (async () => {
      try {
        const principal = await this.authSessionService.requireSession(metadata);
        const stream = this.agentService.streamResponse(
          principal.userId,
          payload.conversationId,
          payload.content,
        );

        for await (const event of stream) {
          subject.next(event);
        }

        subject.complete();
      } catch (error) {
        subject.error(error);
      }
    })();

    return subject.asObservable();
  }

  @GrpcMethod("AiService", "TriggerEmbedding")
  async triggerEmbedding(_payload: unknown, metadata: Metadata) {
    const principal = await this.authSessionService.requireSession(metadata);

    const result = await this.prisma.document.updateMany({
      where: { userId: principal.userId, deleted: false },
      data: { embedded: false },
    });

    await this.jobsService.enqueue("embedding-batch", {
      userId: principal.userId,
    });

    return { documentsQueued: result.count };
  }
}
