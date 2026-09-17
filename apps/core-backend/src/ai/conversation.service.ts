import type { PrismaClient } from "@slate/server-db";

const CONTEXT_WINDOW_SIZE = 20;

/** Message kinds that are rendered in the chat but never replayed to the model. */
const NON_CONTEXT_MESSAGE_KINDS = new Set(["tool_call", "error"]);

export class ConversationService {
  constructor(private readonly prisma: PrismaClient) {}

  async createConversation(userId: string) {
    return this.prisma.conversation.create({
      data: { userId },
    });
  }

  async listConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });
  }

  async deleteConversation(id: string, userId: string) {
    return this.prisma.conversation.delete({
      where: { id, userId },
    });
  }

  async getMessages(conversationId: string, userId: string) {
    // Verify ownership
    await this.prisma.conversation.findFirstOrThrow({
      where: { id: conversationId, userId },
    });

    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });
  }

  async addMessage(
    conversationId: string,
    role: "USER" | "ASSISTANT",
    content: string,
    metadata?: any,
  ) {
    // Count existing messages to check if this is the first USER message
    const existingCount = await this.prisma.message.count({
      where: { conversationId },
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        role,
        content,
        metadata,
      },
    });

    // Auto-title on first USER message
    if (role === "USER" && existingCount === 0) {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          title: content.slice(0, 100),
          updatedAt: new Date(),
        },
      });
    } else {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
    }

    return message;
  }

  /**
   * Drops everything recorded after the last USER message — the partial reply and
   * the error notice from a turn that failed. Used when retrying that same turn so
   * history stays one question, one answer.
   */
  async clearRepliesAfterLastUserMessage(conversationId: string): Promise<number> {
    const lastUserMessage = await this.prisma.message.findFirst({
      where: { conversationId, role: "USER" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    if (!lastUserMessage) {
      return 0;
    }

    const { count } = await this.prisma.message.deleteMany({
      where: { conversationId, createdAt: { gt: lastUserMessage.createdAt } },
    });

    return count;
  }

  async getMessagesForContext(conversationId: string) {
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });

    const totalCount = await this.prisma.message.count({
      where: { conversationId },
    });

    const skip = totalCount > CONTEXT_WINDOW_SIZE ? totalCount - CONTEXT_WINDOW_SIZE : 0;

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      skip,
    });

    return {
      summary: conversation.summary,
      // Tool-call chips and error notices are UI-only rows; replaying them would
      // teach the model to narrate tooling or apologise for its own failures.
      messages: messages.filter(
        (message: any) => !NON_CONTEXT_MESSAGE_KINDS.has(message?.metadata?.kind),
      ),
    };
  }

  async updateSummary(conversationId: string, summary: string) {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { summary },
    });
  }
}
