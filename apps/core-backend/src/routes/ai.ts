import type { FastifyInstance } from "fastify";

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

export default async function aiRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  // ── Get AI config ──

  fastify.get("/api/ai/config", auth, async (request) => {
    const config = await fastify.aiConfigService.getConfig(request.user!.userId);
    return maskConfig(config);
  });

  // ── Update AI config ──

  fastify.put("/api/ai/config", auth, async (request) => {
    const userId = request.user!.userId;
    const body = request.body as {
      embeddingProvider?: string;
      embeddingModel?: string;
      embeddingEndpoint?: string;
      embeddingApiKey?: string;
      chatProvider?: string;
      chatModel?: string;
      chatEndpoint?: string;
      chatApiKey?: string;
    };

    const { config, embeddingModelOrProviderChanged, chatStreamingConfigChanged } =
      await fastify.aiConfigService.upsertConfig(userId, body);

    if (embeddingModelOrProviderChanged || chatStreamingConfigChanged) {
      fastify.modelProviderService.invalidateCache(userId);
    }
    if (chatStreamingConfigChanged) {
      fastify.agentService.abortActiveChatStream(userId);
    }

    return maskConfig(config, { chatStreamingConfigChanged });
  });

  // ── Create conversation ──

  fastify.post("/api/ai/conversations", auth, async (request) => {
    const conversation = await fastify.conversationService.createConversation(request.user!.userId);
    return {
      id: conversation.id,
      title: (conversation as any).title ?? undefined,
      messageCount: 0,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  });

  // ── List conversations ──

  fastify.get("/api/ai/conversations", auth, async (request) => {
    const conversations = await fastify.conversationService.listConversations(request.user!.userId);
    return {
      conversations: conversations.map((c: any) => ({
        id: c.id,
        title: c.title ?? undefined,
        messageCount: c._count?.messages ?? 0,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    };
  });

  // ── Delete conversation ──

  fastify.delete("/api/ai/conversations/:id", auth, async (request) => {
    const { id } = request.params as { id: string };
    await fastify.conversationService.deleteConversation(id, request.user!.userId);
    return {};
  });

  // ── Get conversation messages ──

  fastify.get("/api/ai/conversations/:conversationId/messages", auth, async (request) => {
    const { conversationId } = request.params as { conversationId: string };
    const messages = await fastify.conversationService.getMessages(
      conversationId,
      request.user!.userId,
    );
    return {
      messages: messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        metadata: m.metadata ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });

  // ── Send message (SSE streaming) ──

  fastify.post("/api/ai/conversations/:conversationId/messages", auth, async (request, reply) => {
    const userId = request.user!.userId;
    const { conversationId } = request.params as { conversationId: string };
    const body = request.body as {
      content: string;
      enabledCalendarIds?: string[];
      enabledIcsIds?: string[];
      timezone?: string;
    };
    const { content, enabledCalendarIds = [], enabledIcsIds = [], timezone = "" } = body;

    // Set SSE headers manually
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const writeEvent = (event: object) => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    // Handle abort on client disconnect
    request.raw.on("close", () => {
      fastify.agentService.abortActiveChatStream(userId);
    });

    try {
      const cfg = await fastify.aiConfigService.getConfig(userId);
      if (!cfg?.chatProvider?.trim() || !cfg?.chatModel?.trim()) {
        writeEvent({
          type: "error",
          content: "Select a chat model in Settings before sending messages.",
        });
        reply.raw.end();
        return reply;
      }

      const stream = fastify.agentService.streamResponse(
        userId,
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

    reply.raw.end();
    return reply;
  });

  // ── Trigger embedding ──

  fastify.post("/api/ai/embed", auth, async (request) => {
    const userId = request.user!.userId;
    const result = await fastify.prisma.document.updateMany({
      where: { userId, deleted: false },
      data: { embedded: false },
    });
    await fastify.jobsService.enqueue("embedding-batch", { userId });
    return { documentsQueued: result.count };
  });
}
