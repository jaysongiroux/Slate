import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { AuthSessionService } from "../auth/auth-session.service";
import { AiConfigService } from "./ai-config.service";
import { ConversationService } from "./conversation.service";
import { AgentService } from "./agent.service";
import { EmbeddingService } from "./embedding.service";
import { ModelProviderService } from "./model-provider.service";
import { PrismaService } from "../prisma/prisma.service";
import { JobsService } from "../jobs/jobs.service";
import { HttpAuthGuard } from "../auth/http-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";

function maskConfig(config: any, options?: { chatStreamingConfigChanged?: boolean }) {
  return {
    embeddingProvider: config?.embeddingProvider ?? undefined,
    embeddingModel: config?.embeddingModel ?? undefined,
    embeddingEndpoint: config?.embeddingEndpoint ?? undefined,
    hasEmbeddingApiKey: !!config?.embeddingApiKey,
    chatProvider: config?.chatProvider ?? undefined,
    chatModel: config?.chatModel ?? undefined,
    chatEndpoint: config?.chatEndpoint ?? undefined,
    hasChatApiKey: !!config?.chatApiKey,
    ...(options?.chatStreamingConfigChanged !== undefined
      ? { chatStreamingConfigChanged: options.chatStreamingConfigChanged }
      : {}),
  };
}

@Controller()
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly authSessionService: AuthSessionService,
    private readonly aiConfigService: AiConfigService,
    private readonly conversationService: ConversationService,
    private readonly agentService: AgentService,
    private readonly embeddingService: EmbeddingService,
    private readonly modelProvider: ModelProviderService,
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsService,
  ) {}

  @Get("api/ai/config")
  @UseGuards(HttpAuthGuard)
  async getAiConfigHttp(@CurrentUser() user: { userId: string }) {
    const config = await this.aiConfigService.getConfig(user.userId);
    return maskConfig(config);
  }

  @Put("api/ai/config")
  @UseGuards(HttpAuthGuard)
  async updateAiConfigHttp(
    @Body()
    body: {
      embeddingProvider?: string;
      embeddingModel?: string;
      embeddingEndpoint?: string;
      embeddingApiKey?: string;
      chatProvider?: string;
      chatModel?: string;
      chatEndpoint?: string;
      chatApiKey?: string;
    },
    @CurrentUser() user: { userId: string },
  ) {
    const { config, embeddingModelOrProviderChanged, chatStreamingConfigChanged } =
      await this.aiConfigService.upsertConfig(user.userId, body);
    if (embeddingModelOrProviderChanged || chatStreamingConfigChanged) {
      this.modelProvider.invalidateCache(user.userId);
    }
    if (chatStreamingConfigChanged) {
      this.agentService.abortActiveChatStream(user.userId);
    }
    return maskConfig(config, { chatStreamingConfigChanged });
  }

  @Post("api/ai/conversations")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async createConversationHttp(@CurrentUser() user: { userId: string }) {
    const conversation = await this.conversationService.createConversation(user.userId);
    return {
      id: conversation.id,
      title: (conversation as any).title ?? undefined,
      messageCount: 0,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  @Get("api/ai/conversations")
  @UseGuards(HttpAuthGuard)
  async listConversationsHttp(@CurrentUser() user: { userId: string }) {
    const conversations = await this.conversationService.listConversations(user.userId);
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

  @Delete("api/ai/conversations/:id")
  @UseGuards(HttpAuthGuard)
  async deleteConversationHttp(@Param("id") id: string, @CurrentUser() user: { userId: string }) {
    await this.conversationService.deleteConversation(id, user.userId);
    return {};
  }

  @Get("api/ai/conversations/:conversationId/messages")
  @UseGuards(HttpAuthGuard)
  async getConversationMessagesHttp(
    @Param("conversationId") conversationId: string,
    @CurrentUser() user: { userId: string },
  ) {
    const messages = await this.conversationService.getMessages(conversationId, user.userId);
    return {
      messages: messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  @Post("api/ai/conversations/:conversationId/messages")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async sendMessageHttp(
    @Param("conversationId") conversationId: string,
    @Body()
    body: {
      content: string;
      enabledCalendarIds?: string[];
      enabledIcsIds?: string[];
      timezone?: string;
    },
    @CurrentUser() user: { userId: string },
    @Req() req: any,
    @Res() res: any,
  ): Promise<void> {
    const { content, enabledCalendarIds = [], enabledIcsIds = [], timezone = "" } = body;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const writeEvent = (event: object) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    req.on("close", () => {
      this.agentService.abortActiveChatStream(user.userId);
    });

    try {
      const cfg = await this.aiConfigService.getConfig(user.userId);
      if (!cfg?.chatProvider?.trim() || !cfg?.chatModel?.trim()) {
        writeEvent({
          type: "error",
          content: "Select a chat model in Settings before sending messages.",
        });
        res.end();
        return;
      }

      const stream = this.agentService.streamResponse(
        user.userId,
        conversationId,
        content,
        writeEvent,
        enabledCalendarIds,
        enabledIcsIds,
        timezone,
      );

      for await (const event of stream) {
        writeEvent(event);
      }
    } catch (err: any) {
      const message = err instanceof Error ? err.message : "Stream failed";
      writeEvent({ type: "error", content: message });
    }

    res.end();
  }

  @Post("api/ai/embed")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async triggerEmbeddingHttp(@CurrentUser() user: { userId: string }) {
    const result = await this.prisma.document.updateMany({
      where: { userId: user.userId, deleted: false },
      data: { embedded: false },
    });
    await this.jobsService.enqueue("embedding-batch", { userId: user.userId });
    return { documentsQueued: result.count };
  }
}
