import type { PrismaClient } from "@slate/server-db";
import { ConversationService } from "./conversation.service";

function makePrisma() {
  return {
    conversation: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirstOrThrow: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    message: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
  } as unknown as PrismaClient;
}

describe("ConversationService", () => {
  let service: ConversationService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ConversationService(prisma as unknown as PrismaClient);
  });

  describe("createConversation", () => {
    it("creates a conversation for the given user", async () => {
      const mockConversation = { id: "conv-1", userId: "user-1", title: null, summary: null };
      (prisma.conversation.create as jest.Mock).mockResolvedValue(mockConversation);

      const result = await service.createConversation("user-1");

      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: { userId: "user-1" },
      });
      expect(result).toEqual(mockConversation);
    });
  });

  describe("listConversations", () => {
    it("returns conversations ordered by updatedAt desc with message count", async () => {
      const mockConversations = [
        {
          id: "conv-2",
          userId: "user-1",
          updatedAt: new Date("2024-02-01"),
          _count: { messages: 5 },
        },
        {
          id: "conv-1",
          userId: "user-1",
          updatedAt: new Date("2024-01-01"),
          _count: { messages: 2 },
        },
      ];
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue(mockConversations);

      const result = await service.listConversations("user-1");

      expect(prisma.conversation.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        orderBy: { updatedAt: "desc" },
        include: {
          _count: {
            select: { messages: true },
          },
        },
      });
      expect(result).toEqual(mockConversations);
    });

    it("returns an empty array when the user has no conversations", async () => {
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listConversations("user-2");

      expect(result).toEqual([]);
    });
  });

  describe("addMessage", () => {
    it("auto-titles conversation on first USER message", async () => {
      const content = "Hello, this is my first message";
      const mockMessage = { id: "msg-1", conversationId: "conv-1", role: "USER", content };
      (prisma.message.count as jest.Mock).mockResolvedValue(0);
      (prisma.message.create as jest.Mock).mockResolvedValue(mockMessage);
      (prisma.conversation.update as jest.Mock).mockResolvedValue({});

      await service.addMessage("conv-1", "USER", content);

      expect(prisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "conv-1" },
          data: expect.objectContaining({
            title: content,
          }),
        }),
      );
    });

    it("truncates the auto-title to 100 characters", async () => {
      const longContent = "A".repeat(150);
      (prisma.message.count as jest.Mock).mockResolvedValue(0);
      (prisma.message.create as jest.Mock).mockResolvedValue({});
      (prisma.conversation.update as jest.Mock).mockResolvedValue({});

      await service.addMessage("conv-1", "USER", longContent);

      const updateCall = (prisma.conversation.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.title).toHaveLength(100);
      expect(updateCall.data.title).toBe("A".repeat(100));
    });

    it("does not auto-title on subsequent USER messages", async () => {
      const content = "A follow-up message";
      (prisma.message.count as jest.Mock).mockResolvedValue(1);
      (prisma.message.create as jest.Mock).mockResolvedValue({});
      (prisma.conversation.update as jest.Mock).mockResolvedValue({});

      await service.addMessage("conv-1", "USER", content);

      const updateCall = (prisma.conversation.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.title).toBeUndefined();
    });

    it("does not auto-title on ASSISTANT messages", async () => {
      const content = "I am the assistant";
      (prisma.message.count as jest.Mock).mockResolvedValue(0);
      (prisma.message.create as jest.Mock).mockResolvedValue({});
      (prisma.conversation.update as jest.Mock).mockResolvedValue({});

      await service.addMessage("conv-1", "ASSISTANT", content);

      const updateCall = (prisma.conversation.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.title).toBeUndefined();
    });

    it("always updates the conversation updatedAt", async () => {
      (prisma.message.count as jest.Mock).mockResolvedValue(2);
      (prisma.message.create as jest.Mock).mockResolvedValue({});
      (prisma.conversation.update as jest.Mock).mockResolvedValue({});

      await service.addMessage("conv-1", "USER", "Another message");

      expect(prisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ updatedAt: expect.any(Date) }),
        }),
      );
    });

    it("persists message with role, content, and metadata", async () => {
      const metadata = { tokenCount: 42 };
      (prisma.message.count as jest.Mock).mockResolvedValue(1);
      (prisma.message.create as jest.Mock).mockResolvedValue({});
      (prisma.conversation.update as jest.Mock).mockResolvedValue({});

      await service.addMessage("conv-1", "ASSISTANT", "Hello!", metadata);

      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          conversationId: "conv-1",
          role: "ASSISTANT",
          content: "Hello!",
          metadata,
        },
      });
    });
  });

  describe("clearRepliesAfterLastUserMessage", () => {
    it("deletes everything the assistant produced after the last user message", async () => {
      const lastUserMessage = { id: "msg-1", createdAt: new Date("2026-09-10T12:00:00.000Z") };
      (prisma.message.findFirst as jest.Mock).mockResolvedValue(lastUserMessage);
      (prisma.message.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });

      const deleted = await service.clearRepliesAfterLastUserMessage("conv-1");

      expect(prisma.message.findFirst).toHaveBeenCalledWith({
        where: { conversationId: "conv-1", role: "USER" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      expect(prisma.message.deleteMany).toHaveBeenCalledWith({
        where: { conversationId: "conv-1", createdAt: { gt: lastUserMessage.createdAt } },
      });
      expect(deleted).toBe(2);
    });

    it("deletes nothing when the conversation has no user message", async () => {
      (prisma.message.findFirst as jest.Mock).mockResolvedValue(null);

      const deleted = await service.clearRepliesAfterLastUserMessage("conv-1");

      expect(prisma.message.deleteMany).not.toHaveBeenCalled();
      expect(deleted).toBe(0);
    });
  });

  describe("getMessagesForContext", () => {
    it("returns summary and all messages when total is within window size", async () => {
      const mockConversation = { id: "conv-1", summary: "A quick summary", title: "Test" };
      const mockMessages = [
        { id: "msg-1", role: "USER", content: "Hi" },
        { id: "msg-2", role: "ASSISTANT", content: "Hello" },
      ];
      (prisma.conversation.findUniqueOrThrow as jest.Mock).mockResolvedValue(mockConversation);
      (prisma.message.count as jest.Mock).mockResolvedValue(2);
      (prisma.message.findMany as jest.Mock).mockResolvedValue(mockMessages);

      const result = await service.getMessagesForContext("conv-1");

      expect(result.summary).toBe("A quick summary");
      expect(result.messages).toEqual(mockMessages);
      expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
    });

    it("skips oldest messages when total exceeds window size of 20", async () => {
      const mockConversation = { id: "conv-1", summary: null };
      (prisma.conversation.findUniqueOrThrow as jest.Mock).mockResolvedValue(mockConversation);
      (prisma.message.count as jest.Mock).mockResolvedValue(25);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);

      await service.getMessagesForContext("conv-1");

      expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 5 }));
    });

    it("returns null summary when conversation has no summary", async () => {
      const mockConversation = { id: "conv-1", summary: null };
      (prisma.conversation.findUniqueOrThrow as jest.Mock).mockResolvedValue(mockConversation);
      (prisma.message.count as jest.Mock).mockResolvedValue(3);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getMessagesForContext("conv-1");

      expect(result.summary).toBeNull();
    });

    it("orders messages by createdAt ascending", async () => {
      const mockConversation = { id: "conv-1", summary: null };
      (prisma.conversation.findUniqueOrThrow as jest.Mock).mockResolvedValue(mockConversation);
      (prisma.message.count as jest.Mock).mockResolvedValue(5);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);

      await service.getMessagesForContext("conv-1");

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: "asc" },
        }),
      );
    });

    it("does not skip any messages when total equals window size exactly", async () => {
      const mockConversation = { id: "conv-1", summary: null };
      (prisma.conversation.findUniqueOrThrow as jest.Mock).mockResolvedValue(mockConversation);
      (prisma.message.count as jest.Mock).mockResolvedValue(20);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);

      await service.getMessagesForContext("conv-1");

      expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
    });

    it("filters tool call messages out of model context", async () => {
      const mockConversation = { id: "conv-1", summary: null };
      (prisma.conversation.findUniqueOrThrow as jest.Mock).mockResolvedValue(mockConversation);
      (prisma.message.count as jest.Mock).mockResolvedValue(3);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([
        { id: "msg-1", role: "USER", content: "Hi", metadata: null },
        {
          id: "msg-2",
          role: "ASSISTANT",
          content: "Using tool: edit_note…",
          metadata: { kind: "tool_call", toolName: "edit_note" },
        },
        { id: "msg-3", role: "ASSISTANT", content: "Done", metadata: null },
      ]);

      const result = await service.getMessagesForContext("conv-1");

      expect(result.messages).toEqual([
        { id: "msg-1", role: "USER", content: "Hi", metadata: null },
        { id: "msg-3", role: "ASSISTANT", content: "Done", metadata: null },
      ]);
    });

    it("filters error notices out of model context", async () => {
      const mockConversation = { id: "conv-1", summary: null };
      (prisma.conversation.findUniqueOrThrow as jest.Mock).mockResolvedValue(mockConversation);
      (prisma.message.count as jest.Mock).mockResolvedValue(2);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([
        { id: "msg-1", role: "USER", content: "Summarize my projects", metadata: null },
        {
          id: "msg-2",
          role: "ASSISTANT",
          content: "Out of API credits",
          metadata: { kind: "error", code: "provider_no_credits" },
        },
      ]);

      const result = await service.getMessagesForContext("conv-1");

      expect(result.messages).toEqual([
        { id: "msg-1", role: "USER", content: "Summarize my projects", metadata: null },
      ]);
    });
  });
});
