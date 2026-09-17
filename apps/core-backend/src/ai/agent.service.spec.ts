import type { PrismaClient } from "@slate/server-db";
import { ModelProviderService } from "./model-provider.service";
import { AiConfigService } from "./ai-config.service";
import { ConversationService } from "./conversation.service";
import { SearchService } from "../search/search.service";
import { CalendarService } from "../calendar/calendar.service";
import { IcsService } from "../calendar/ics.service";
import { AgentService } from "./agent.service";
import { HOME_ASSISTANT_ENABLED_SETTING_KEY } from "@slate/shared";
import type { HomeAssistantService } from "../home-assistant/home-assistant.service";

function makePrisma(settingValue: unknown = null) {
  return {
    setting: {
      findFirst: jest.fn().mockResolvedValue(
        settingValue === null
          ? null
          : {
              value: settingValue,
            },
      ),
    },
  } as unknown as PrismaClient;
}

function makeModelProvider() {
  return {
    getChatModel: jest.fn(),
    getEmbeddingModel: jest.fn(),
    getEmbeddingModelOrNull: jest.fn().mockResolvedValue(null),
  } as unknown as ModelProviderService;
}

function makeAiConfigService(config: unknown = { chatProvider: "OPENAI", chatModel: "gpt-4o" }) {
  return {
    getConfig: jest.fn().mockResolvedValue(config),
  } as unknown as AiConfigService;
}

function makeConversationService() {
  return {
    addMessage: jest.fn().mockResolvedValue({}),
    clearRepliesAfterLastUserMessage: jest.fn().mockResolvedValue(0),
    getMessagesForContext: jest.fn().mockResolvedValue({
      summary: null,
      messages: [],
    }),
  } as unknown as ConversationService;
}

/** The literal failure LangChain raised when the OpenAI account ran out of credits. */
const OPENAI_NO_CREDITS =
  "429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.";

/** Minimal stand-in for a bound chat model whose stream rejects. */
function makeFailingChatModel(error: unknown) {
  const model = {
    bindTools: () => ({
      stream: async () => {
        throw error;
      },
    }),
  };
  return model as never;
}

function makeSearchService() {
  return {
    search: jest.fn().mockResolvedValue({ results: [] }),
  } as unknown as SearchService;
}

function makeHomeAssistantService(instances: unknown[] = []) {
  return {
    listInstances: jest.fn().mockResolvedValue(instances),
  } as unknown as HomeAssistantService;
}

describe("AgentService", () => {
  let service: AgentService;
  let prisma: ReturnType<typeof makePrisma>;
  let modelProvider: ReturnType<typeof makeModelProvider>;
  let aiConfigService: ReturnType<typeof makeAiConfigService>;
  let conversationService: ReturnType<typeof makeConversationService>;
  let searchService: ReturnType<typeof makeSearchService>;
  let homeAssistantService: ReturnType<typeof makeHomeAssistantService>;

  beforeEach(() => {
    prisma = makePrisma();
    modelProvider = makeModelProvider();
    aiConfigService = makeAiConfigService();
    conversationService = makeConversationService();
    searchService = makeSearchService();
    homeAssistantService = makeHomeAssistantService();
    service = new AgentService(
      prisma as unknown as PrismaClient,
      modelProvider as unknown as ModelProviderService,
      aiConfigService as unknown as AiConfigService,
      conversationService as unknown as ConversationService,
      searchService as unknown as SearchService,
      {} as unknown as CalendarService,
      {} as unknown as IcsService,
      homeAssistantService as unknown as HomeAssistantService,
    );
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("streamResponse error handling", () => {
    const collect = async (retry = false) => {
      const events = [];
      for await (const event of service.streamResponse(
        "user-1",
        "conv-1",
        "Summarize the projects I worked on for the past 6 months",
        jest.fn(),
        [],
        [],
        "UTC",
        retry,
      )) {
        events.push(event);
      }
      return events;
    };

    beforeEach(() => {
      (modelProvider.getChatModel as jest.Mock).mockResolvedValue(
        makeFailingChatModel(Object.assign(new Error(OPENAI_NO_CREDITS), { status: 429 })),
      );
    });

    it("yields a classified error event instead of throwing", async () => {
      const events = await collect();

      const error = events.find((event) => event.type === "error");
      expect(error).toMatchObject({
        type: "error",
        code: "provider_no_credits",
        title: "Out of API credits",
        retryable: false,
        actionUrl: "https://platform.openai.com/settings/organization/billing",
      });
      expect(error!.content).toContain("OpenAI");
      expect(error!.detail).toContain("no credits remaining");
    });

    it("does not emit a done event for a failed turn", async () => {
      const events = await collect();

      expect(events.map((event) => event.type)).not.toContain("done");
    });

    it("persists the failure as an error notice so it survives a reload", async () => {
      await collect();

      expect(conversationService.addMessage).toHaveBeenCalledWith(
        "conv-1",
        "ASSISTANT",
        expect.stringContaining("credits"),
        expect.objectContaining({
          kind: "error",
          code: "provider_no_credits",
          title: "Out of API credits",
          retryable: false,
        }),
      );
    });

    it("still records the user message for a failed turn", async () => {
      await collect();

      expect(conversationService.addMessage).toHaveBeenCalledWith(
        "conv-1",
        "USER",
        "Summarize the projects I worked on for the past 6 months",
      );
    });

    it("releases the per-user stream lock so the next turn is not skipped", async () => {
      await collect();
      const events = await collect();

      expect(events.some((event) => event.type === "error")).toBe(true);
    });

    it("classifies an unreachable local provider without mentioning credits", async () => {
      aiConfigService = makeAiConfigService({
        chatProvider: "OLLAMA",
        chatModel: "llama3",
        chatEndpoint: "http://localhost:11434",
      });
      (modelProvider.getChatModel as jest.Mock).mockResolvedValue(
        makeFailingChatModel(new Error("connect ECONNREFUSED 127.0.0.1:11434")),
      );
      service = new AgentService(
        prisma as unknown as PrismaClient,
        modelProvider as unknown as ModelProviderService,
        aiConfigService as unknown as AiConfigService,
        conversationService as unknown as ConversationService,
        searchService as unknown as SearchService,
        {} as unknown as CalendarService,
        {} as unknown as IcsService,
        homeAssistantService as unknown as HomeAssistantService,
      );

      const events = await collect();

      const error = events.find((event) => event.type === "error");
      expect(error).toMatchObject({ code: "provider_unavailable", retryable: true });
      expect(error!.content).toContain("http://localhost:11434");
    });
  });

  describe("streamResponse retry", () => {
    const collect = async (retry: boolean) => {
      const events = [];
      for await (const event of service.streamResponse(
        "user-1",
        "conv-1",
        "Summarize my projects",
        jest.fn(),
        [],
        [],
        "UTC",
        retry,
      )) {
        events.push(event);
      }
      return events;
    };

    beforeEach(() => {
      (modelProvider.getChatModel as jest.Mock).mockResolvedValue(
        makeFailingChatModel(Object.assign(new Error(OPENAI_NO_CREDITS), { status: 429 })),
      );
    });

    it("does not duplicate the user message when retrying a failed turn", async () => {
      await collect(true);

      expect(conversationService.addMessage).not.toHaveBeenCalledWith(
        "conv-1",
        "USER",
        "Summarize my projects",
      );
    });

    it("clears the stale replies from the failed turn before retrying", async () => {
      await collect(true);

      expect(conversationService.clearRepliesAfterLastUserMessage).toHaveBeenCalledWith("conv-1");
    });

    it("does not clear replies on a normal turn", async () => {
      await collect(false);

      expect(conversationService.clearRepliesAfterLastUserMessage).not.toHaveBeenCalled();
    });
  });

  describe("buildSystemMessages", () => {
    it("returns the base system prompt when summary is null", () => {
      const result = service.buildSystemMessages(null, false);

      expect(result).toContain(
        "You are a helpful AI assistant for a note-taking application called Slate.",
      );
      expect(result).toContain("create_note or edit_note tools");
      expect(result).toContain("Tool-use protocol");
      expect(result).toContain("natural-language message");
    });

    it("always includes current date, time, and timezone", () => {
      const result = service.buildSystemMessages(null, false, "America/Toronto");

      expect(result).toContain("timezone: America/Toronto");
      expect(result).toContain("The current date and time is");
    });

    it("defaults to UTC when timezone is not provided", () => {
      const result = service.buildSystemMessages(null, false);

      expect(result).toContain("timezone: UTC");
    });

    it("appends conversation summary when summary is provided", () => {
      const summary = "The user asked about their project notes.";
      const result = service.buildSystemMessages(summary, false);

      expect(result).toContain(
        "You are a helpful AI assistant for a note-taking application called Slate.",
      );
      expect(result).toContain(
        `\n\nHere is a summary of the earlier part of this conversation:\n${summary}`,
      );
    });

    it("does not append summary section when summary is empty string", () => {
      const result = service.buildSystemMessages("", false);

      expect(result).not.toContain("Here is a summary");
    });

    it("includes calendar instructions when hasCalendar is true", () => {
      const result = service.buildSystemMessages(null, true);

      expect(result).toContain("You have access to the user's calendar");
      expect(result).toContain("confirm with the user before deleting events");
    });

    it("excludes calendar instructions when hasCalendar is false", () => {
      const result = service.buildSystemMessages(null, false);

      expect(result).not.toContain("You have access to the user's calendar");
    });

    it("includes Home Assistant instructions when Home Assistant tools are available", () => {
      const result = service.buildSystemMessages(null, false, "UTC", true);

      expect(result).toContain("Home Assistant entities");
      expect(result).toContain("backend proxy");
      expect(result).toContain("list_home_assistant_instances");
      expect(result).toContain("default");
    });
  });

  describe("buildHomeAssistantToolsForUser", () => {
    it("does not register tools when the extension setting is disabled", async () => {
      prisma = makePrisma(false);
      homeAssistantService = makeHomeAssistantService([{ id: "ha-1" }]);
      service = new AgentService(
        prisma as unknown as PrismaClient,
        modelProvider as unknown as ModelProviderService,
        aiConfigService as unknown as AiConfigService,
        conversationService as unknown as ConversationService,
        searchService as unknown as SearchService,
        {} as unknown as CalendarService,
        {} as unknown as IcsService,
        homeAssistantService as unknown as HomeAssistantService,
      );

      await expect(service.buildHomeAssistantToolsForUser("user-1")).resolves.toEqual([]);
      expect((prisma as any).setting.findFirst).toHaveBeenCalledWith({
        where: { userId: "user-1", key: HOME_ASSISTANT_ENABLED_SETTING_KEY },
        select: { value: true },
      });
    });

    it("does not register tools when no instances exist", async () => {
      prisma = makePrisma(true);
      homeAssistantService = makeHomeAssistantService([]);
      service = new AgentService(
        prisma as unknown as PrismaClient,
        modelProvider as unknown as ModelProviderService,
        aiConfigService as unknown as AiConfigService,
        conversationService as unknown as ConversationService,
        searchService as unknown as SearchService,
        {} as unknown as CalendarService,
        {} as unknown as IcsService,
        homeAssistantService as unknown as HomeAssistantService,
      );

      await expect(service.buildHomeAssistantToolsForUser("user-1")).resolves.toEqual([]);
    });

    it("registers the safe starter tools when enabled and instances exist", async () => {
      prisma = makePrisma(true);
      homeAssistantService = makeHomeAssistantService([{ id: "ha-1" }]);
      service = new AgentService(
        prisma as unknown as PrismaClient,
        modelProvider as unknown as ModelProviderService,
        aiConfigService as unknown as AiConfigService,
        conversationService as unknown as ConversationService,
        searchService as unknown as SearchService,
        {} as unknown as CalendarService,
        {} as unknown as IcsService,
        homeAssistantService as unknown as HomeAssistantService,
      );

      const tools = await service.buildHomeAssistantToolsForUser("user-1");

      expect(tools.map((tool: any) => tool.name)).toEqual([
        "list_home_assistant_instances",
        "search_home_assistant_entities",
        "search_home_assistant_devices",
        "list_home_assistant_device_entities",
        "get_home_assistant_entity",
        "control_home_assistant_entity",
      ]);
      expect(tools.map((tool: any) => tool.name)).not.toContain("list_home_assistant_entities");
    });
  });
});
