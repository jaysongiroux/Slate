import type { PrismaClient } from "@slate/server-db";
import { ModelProviderService } from "./model-provider.service";
import { AiConfigService } from "./ai-config.service";
import { ConversationService } from "./conversation.service";
import { SearchService } from "../search/search.service";
import { CalendarService } from "../calendar/calendar.service";
import { IcsService } from "../calendar/ics.service";
import { AgentService } from "./agent.service";

function makePrisma() {
  return {} as unknown as PrismaClient;
}

function makeModelProvider() {
  return {
    getChatModel: jest.fn(),
    getEmbeddingModel: jest.fn(),
    getEmbeddingModelOrNull: jest.fn().mockResolvedValue(null),
  } as unknown as ModelProviderService;
}

function makeAiConfigService() {
  return {
    getConfig: jest.fn().mockResolvedValue(null),
  } as unknown as AiConfigService;
}

function makeConversationService() {
  return {
    addMessage: jest.fn().mockResolvedValue({}),
    getMessagesForContext: jest.fn().mockResolvedValue({
      summary: null,
      messages: [],
    }),
  } as unknown as ConversationService;
}

function makeSearchService() {
  return {
    search: jest.fn().mockResolvedValue({ results: [] }),
  } as unknown as SearchService;
}

describe("AgentService", () => {
  let service: AgentService;
  let prisma: ReturnType<typeof makePrisma>;
  let modelProvider: ReturnType<typeof makeModelProvider>;
  let aiConfigService: ReturnType<typeof makeAiConfigService>;
  let conversationService: ReturnType<typeof makeConversationService>;
  let searchService: ReturnType<typeof makeSearchService>;

  beforeEach(() => {
    prisma = makePrisma();
    modelProvider = makeModelProvider();
    aiConfigService = makeAiConfigService();
    conversationService = makeConversationService();
    searchService = makeSearchService();
    service = new AgentService(
      prisma as unknown as PrismaClient,
      modelProvider as unknown as ModelProviderService,
      aiConfigService as unknown as AiConfigService,
      conversationService as unknown as ConversationService,
      searchService as unknown as SearchService,
      {} as unknown as CalendarService,
      {} as unknown as IcsService,
    );
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
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
  });
});
