import { Test, TestingModule } from "@nestjs/testing";
import { AiController } from "./ai.controller";
import { AiConfigService } from "./ai-config.service";
import { ConversationService } from "./conversation.service";
import { AgentService } from "./agent.service";
import { EmbeddingService } from "./embedding.service";
import { ModelProviderService } from "./model-provider.service";
import { PrismaService } from "../prisma/prisma.service";
import { JobsService } from "../jobs/jobs.service";
import { AuthSessionService } from "../auth/auth-session.service";
import { HttpAuthGuard } from "../auth/http-auth.guard";

describe("AiController HTTP endpoints", () => {
  let controller: AiController;
  let aiConfigService: jest.Mocked<Partial<AiConfigService>>;
  let conversationService: jest.Mocked<Partial<ConversationService>>;
  let agentService: jest.Mocked<Partial<AgentService>>;
  let modelProvider: jest.Mocked<Partial<ModelProviderService>>;
  let prisma: jest.Mocked<any>;
  let jobsService: jest.Mocked<Partial<JobsService>>;

  const user = { userId: "u1" };

  beforeEach(async () => {
    const cfg = { chatProvider: "openai", chatModel: "gpt-4" };
    aiConfigService = {
      getConfig: jest.fn().mockResolvedValue(cfg),
      upsertConfig: jest.fn().mockResolvedValue({
        config: cfg,
        embeddingModelOrProviderChanged: false,
        chatStreamingConfigChanged: false,
      }),
    };
    conversationService = {
      createConversation: jest
        .fn()
        .mockResolvedValue({ id: "c1", title: null, createdAt: new Date(), updatedAt: new Date() }),
      listConversations: jest.fn().mockResolvedValue([]),
      deleteConversation: jest.fn().mockResolvedValue(undefined),
      getMessages: jest.fn().mockResolvedValue([]),
    };
    agentService = { abortActiveChatStream: jest.fn() };
    modelProvider = { invalidateCache: jest.fn() };
    prisma = { document: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    jobsService = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        { provide: AiConfigService, useValue: aiConfigService },
        { provide: ConversationService, useValue: conversationService },
        { provide: AgentService, useValue: agentService },
        { provide: EmbeddingService, useValue: {} },
        { provide: ModelProviderService, useValue: modelProvider },
        { provide: PrismaService, useValue: prisma },
        { provide: JobsService, useValue: jobsService },
        { provide: AuthSessionService, useValue: {} },
        { provide: HttpAuthGuard, useValue: { canActivate: () => true } },
      ],
    })
      .overrideGuard(HttpAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AiController>(AiController);
  });

  it("getAiConfigHttp returns masked config", async () => {
    const result = await controller.getAiConfigHttp(user as any);
    expect(result).toMatchObject({ chatProvider: "openai", chatModel: "gpt-4" });
  });

  it("createConversationHttp returns new conversation", async () => {
    const result = await controller.createConversationHttp(user as any);
    expect(result).toMatchObject({ id: "c1", messageCount: 0 });
  });

  it("listConversationsHttp returns array", async () => {
    const result = await controller.listConversationsHttp(user as any);
    expect(result).toEqual({ conversations: [] });
  });

  it("deleteConversationHttp delegates to service", async () => {
    await controller.deleteConversationHttp("c1", user as any);
    expect(conversationService.deleteConversation).toHaveBeenCalledWith("c1", "u1");
  });

  it("getConversationMessagesHttp returns messages", async () => {
    const result = await controller.getConversationMessagesHttp("c1", user as any);
    expect(result).toEqual({ messages: [] });
  });

  it("triggerEmbeddingHttp enqueues embedding job", async () => {
    const result = await controller.triggerEmbeddingHttp(user as any);
    expect(result).toMatchObject({ documentsQueued: 0 });
  });
});
