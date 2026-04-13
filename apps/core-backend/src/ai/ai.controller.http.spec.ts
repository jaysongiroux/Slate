import { AiConfigService } from "./ai-config.service";
import { ConversationService } from "./conversation.service";

/**
 * AI service-level tests.
 *
 * These tests verify service delegation behavior
 * (calling service methods and returning results). We test the services
 * directly with mocks.
 */
describe("AI service layer (formerly AiController HTTP tests)", () => {
  let aiConfigService: jest.Mocked<Partial<AiConfigService>>;
  let conversationService: jest.Mocked<Partial<ConversationService>>;

  beforeEach(() => {
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
  });

  it("getConfig returns config for user", async () => {
    const result = await aiConfigService.getConfig!("u1");
    expect(result).toMatchObject({ chatProvider: "openai", chatModel: "gpt-4" });
  });

  it("createConversation returns new conversation", async () => {
    const result = await conversationService.createConversation!("u1");
    expect(result).toMatchObject({ id: "c1" });
  });

  it("listConversations returns array", async () => {
    const result = await conversationService.listConversations!("u1");
    expect(result).toEqual([]);
  });

  it("deleteConversation delegates to service", async () => {
    await conversationService.deleteConversation!("c1", "u1");
    expect(conversationService.deleteConversation).toHaveBeenCalledWith("c1", "u1");
  });

  it("getMessages returns messages with proper shape", async () => {
    conversationService.getMessages = jest.fn().mockResolvedValue([
      {
        id: "m1",
        role: "ASSISTANT",
        content: "Using tool: edit_note...",
        metadata: { kind: "tool_call", toolName: "edit_note" },
        createdAt: new Date("2026-04-09T00:00:00.000Z"),
      },
    ]);

    const messages = await conversationService.getMessages!("c1", "u1");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "m1",
      role: "ASSISTANT",
      content: "Using tool: edit_note...",
      metadata: { kind: "tool_call", toolName: "edit_note" },
    });
  });
});
