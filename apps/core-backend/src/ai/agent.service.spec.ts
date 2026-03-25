import { PrismaService } from "../prisma/prisma.service";
import { ModelProviderService } from "./model-provider.service";
import { AiConfigService } from "./ai-config.service";
import { ConversationService } from "./conversation.service";
import { SearchService } from "../search/search.service";
import { CrdtService } from "../documents/crdt.service";
import { DocumentsService } from "../documents/documents.service";
import { AgentService } from "./agent.service";

function makePrisma() {
  return {} as unknown as PrismaService;
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

function makeCrdtService() {
  return {} as unknown as CrdtService;
}

function makeDocumentsService() {
  return {} as unknown as DocumentsService;
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
      prisma as unknown as PrismaService,
      modelProvider as unknown as ModelProviderService,
      aiConfigService as unknown as AiConfigService,
      conversationService as unknown as ConversationService,
      searchService as unknown as SearchService,
      makeCrdtService(),
      makeDocumentsService(),
    );
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("buildSystemMessages", () => {
    it("returns the base system prompt when summary is null", () => {
      const result = service.buildSystemMessages(null);

      expect(result).toContain(
        "You are a helpful AI assistant for a note-taking application called Slate.",
      );
      expect(result).toContain("create_note or edit_note tools");
      expect(result).toContain("Tool-use protocol");
      expect(result).toContain("natural-language message");
    });

    it("appends conversation summary when summary is provided", () => {
      const summary = "The user asked about their project notes.";
      const result = service.buildSystemMessages(summary);

      expect(result).toContain(
        "You are a helpful AI assistant for a note-taking application called Slate.",
      );
      expect(result).toContain(
        `\n\nHere is a summary of the earlier part of this conversation:\n${summary}`,
      );
    });

    it("does not append summary section when summary is empty string", () => {
      const result = service.buildSystemMessages("");

      expect(result).not.toContain("Here is a summary");
    });
  });
});
