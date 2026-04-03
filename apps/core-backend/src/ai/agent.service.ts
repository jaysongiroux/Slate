import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ModelProviderService } from "./model-provider.service";
import { AiConfigService } from "./ai-config.service";
import { ConversationService } from "./conversation.service";
import { SearchService } from "../search/search.service";
import { CrdtService } from "../documents/crdt.service";
import { DocumentsService } from "../documents/documents.service";
import { createVectorSearchTool } from "./tools/vector-search.tool";
import { createTitleSearchTool } from "./tools/title-search.tool";
import { createGetNoteTool } from "./tools/get-note.tool";
import { createListRecentTool } from "./tools/list-recent.tool";
import { createFullTextSearchTool } from "./tools/full-text-search.tool";
import { createCreateNoteTool } from "./tools/create-note.tool";
import { createEditNoteTool } from "./tools/edit-note.tool";
import { wrapToolsWithPerformanceLogging } from "./wrap-tools-performance-log";
import { createListCalendarsTool } from "./tools/list-calendars.tool";
import { createListCalendarEventsTool } from "./tools/list-calendar-events.tool";
import { createGetCalendarEventTool } from "./tools/get-calendar-event.tool";
import { createCheckAvailabilityTool } from "./tools/check-availability.tool";
import { createCreateCalendarEventTool } from "./tools/create-calendar-event.tool";
import { createUpdateCalendarEventTool } from "./tools/update-calendar-event.tool";
import { createDeleteCalendarEventTool } from "./tools/delete-calendar-event.tool";
import { createRsvpCalendarEventTool } from "./tools/rsvp-calendar-event.tool";
import { CalendarService } from "../calendar/calendar.service";
import { IcsService } from "../calendar/ics.service";
import { StateGraph, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { Annotation } from "@langchain/langgraph";
import {
  HumanMessage,
  AIMessage,
  AIMessageChunk,
  SystemMessage,
  BaseMessage,
  isAIMessageChunk,
} from "@langchain/core/messages";
import { concatAiMessageChunksSafe } from "./ai-message-chunk-merge";

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

export interface StreamEvent {
  type:
    | "token"
    | "tool_call"
    | "done"
    | "note_create_start"
    | "note_edit_start"
    | "note_delta"
    | "note_done";
  content?: string;
  toolName?: string;
  documentId?: string;
  title?: string;
  path?: string;
  error?: string;
}

function textDeltaFromAiMessage(message: BaseMessage): string {
  if (message._getType() !== "ai") {
    return "";
  }
  const c = message.content;
  if (typeof c === "string") {
    return c;
  }
  if (Array.isArray(c)) {
    return c
      .map((block) =>
        typeof block === "object" &&
        block !== null &&
        "text" in block &&
        typeof (block as { text: unknown }).text === "string"
          ? (block as { text: string }).text
          : "",
      )
      .join("");
  }
  return "";
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  /** One in-flight graph stream per user; abort the controller to stop generation (e.g. model change in Settings). */
  private readonly activeStreamAbortControllers = new Map<string, AbortController>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly modelProvider: ModelProviderService,
    private readonly aiConfigService: AiConfigService,
    private readonly conversationService: ConversationService,
    private readonly searchService: SearchService,
    private readonly crdtService: CrdtService,
    private readonly documentsService: DocumentsService,
    private readonly calendarService: CalendarService,
    private readonly icsService: IcsService,
  ) {}

  /** Stops the current SendMessage graph stream for this user without persisting a partial assistant reply. */
  abortActiveChatStream(userId: string): void {
    const ac = this.activeStreamAbortControllers.get(userId);
    if (ac) {
      this.logger.log(`[ai-chat] abortActiveChatStream userId=${userId}`);
      ac.abort();
    }
  }

  buildSystemMessages(summary: string | null, hasCalendar: boolean, timezone?: string): string {
    const now = new Date();
    const tz = timezone || "UTC";
    let formattedNow: string;
    try {
      formattedNow = now.toLocaleString("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "long" });
    } catch {
      formattedNow = now.toISOString();
    }

    let prompt =
      "You are a helpful AI assistant for a note-taking application called Slate. You have access to the user's personal notes and can search, retrieve, and answer questions about them. When answering questions, cite the source notes by their title. Be concise and helpful.";

    prompt += `\n\nThe current date and time is ${formattedNow} (timezone: ${tz}).`;

    prompt +=
      "\n\nYou can also create new notes and edit existing ones. When a user asks you to write, draft, create, or modify a note, use the create_note or edit_note tools. For create_note, provide a clear title and detailed instructions about what to write. For edit_note, first use search tools to find the note's document ID, then provide the ID and precise instructions for the changes. Prefer targeted edits for long notes and full rewrites for short ones.";

    if (hasCalendar) {
      prompt += "\n\nYou have access to the user's calendar. You can list events, check availability, create/update/delete events, and RSVP to invitations. Always confirm with the user before deleting events. When creating events, confirm the details before proceeding unless the user's request is unambiguous.";
    }

    prompt +=
      "\n\nTool-use protocol: Whenever you invoke a tool and receive a result, you must continue the turn with a short natural-language message to the user—confirm what you did, summarize findings, or ask a clarifying question. Do not end your response with only tool calls and no user-visible text. After tools run, always reply once more so the conversation has a clear assistant message before you stop.";

    if (summary) {
      prompt += `\n\nHere is a summary of the earlier part of this conversation:\n${summary}`;
    }

    return prompt;
  }

  async *streamResponse(
    userId: string,
    conversationId: string,
    userMessage: string,
    emitNoteEvent: (event: StreamEvent) => void,
    enabledCalendarIds: string[] = [],
    enabledIcsIds: string[] = [],
    timezone: string = "",
  ): AsyncGenerator<StreamEvent> {
    if (this.activeStreamAbortControllers.has(userId)) {
      this.logger.warn(
        `[ai-chat] stream skipped: already active for userId=${userId} conversationId=${conversationId}`,
      );
      yield { type: "done" as const };
      return;
    }
    const streamAbort = new AbortController();
    this.activeStreamAbortControllers.set(userId, streamAbort);
    try {
      this.logger.log(
        `[ai-chat] agent stream start userId=${userId} conversationId=${conversationId} userMessageChars=${userMessage.length}`,
      );
      // Save the user message
      await this.conversationService.addMessage(conversationId, "USER", userMessage);

      // Load conversation context
      const { summary, messages: history } =
        await this.conversationService.getMessagesForContext(conversationId);

      // Get models
      const chatModel = await this.modelProvider.getChatModel(userId);
      const embeddingModel = await this.modelProvider.getEmbeddingModelOrNull(userId);
      const aiConfig =
        embeddingModel !== null ? await this.aiConfigService.getConfig(userId) : null;
      const embeddingModelId = aiConfig?.embeddingModel ?? null;

      // Create tools (vector search only when embeddings are configured)
      const hasCalendar = enabledCalendarIds.length > 0 || enabledIcsIds.length > 0;
      const tools = [
        ...(embeddingModel && embeddingModelId
          ? [createVectorSearchTool(this.prisma, embeddingModel, userId, embeddingModelId)]
          : []),
        createTitleSearchTool(this.prisma, userId),
        createGetNoteTool(this.prisma, userId),
        createListRecentTool(this.prisma, userId),
        createFullTextSearchTool(this.searchService, userId),
        createCreateNoteTool(
          this.prisma,
          this.crdtService,
          this.documentsService,
          userId,
          chatModel,
          emitNoteEvent,
        ),
        createEditNoteTool(
          this.prisma,
          this.crdtService,
          this.documentsService,
          userId,
          chatModel,
          emitNoteEvent,
        ),
        // Calendar tools (only when user has calendars enabled for AI)
        ...(hasCalendar
          ? (this.logger.log(
              `[ai-chat] registering calendar tools userId=${userId} enabledCalendarIds=[${enabledCalendarIds.join(",")}] enabledIcsIds=[${enabledIcsIds.join(",")}]`,
            ),
          [
              createListCalendarsTool(this.calendarService, userId, enabledCalendarIds, enabledIcsIds, this.logger),
              createListCalendarEventsTool(this.calendarService, this.icsService, userId, enabledCalendarIds, enabledIcsIds, this.logger),
              createGetCalendarEventTool(this.calendarService, this.icsService, userId, enabledCalendarIds, enabledIcsIds, this.logger),
              createCheckAvailabilityTool(this.calendarService, this.icsService, userId, enabledCalendarIds, enabledIcsIds, this.logger),
              createCreateCalendarEventTool(this.calendarService, userId, enabledCalendarIds, enabledIcsIds, this.logger),
              createUpdateCalendarEventTool(this.calendarService, userId, enabledCalendarIds, enabledIcsIds, this.logger),
              createDeleteCalendarEventTool(this.calendarService, userId, enabledCalendarIds, enabledIcsIds, this.logger),
              createRsvpCalendarEventTool(this.calendarService, userId, enabledCalendarIds, enabledIcsIds, this.logger),
            ])
          : []),
      ];

      wrapToolsWithPerformanceLogging(this.logger, tools as any, {
        userId,
        conversationId,
      });

      // Bind tools to model
      const modelWithTools = (chatModel as any).bindTools(tools);

      // Stream model output so providers emit tokens (required for Ollama + LangGraph callbacks).
      const agentNode = async (state: typeof AgentState.State) => {
        const stream = await modelWithTools.stream(state.messages);
        let acc: AIMessageChunk | undefined;
        for await (const chunk of stream) {
          if (isAIMessageChunk(chunk)) {
            acc = concatAiMessageChunksSafe(acc, chunk);
          }
        }
        if (!acc) {
          return { messages: [] };
        }
        const response = new AIMessage({
          id: acc.id,
          content: acc.content,
          tool_calls: acc.tool_calls,
          invalid_tool_calls: acc.invalid_tool_calls,
          additional_kwargs: acc.additional_kwargs,
          response_metadata: acc.response_metadata,
          usage_metadata: acc.usage_metadata,
        });
        return { messages: [response] };
      };

      // Define tool node
      const toolNode = new ToolNode(tools as any);

      // Conditional edge: check if the last message has tool calls
      const shouldContinue = (state: typeof AgentState.State) => {
        const lastMessage = state.messages[state.messages.length - 1];
        if (
          "tool_calls" in lastMessage &&
          Array.isArray((lastMessage as any).tool_calls) &&
          (lastMessage as any).tool_calls.length > 0
        ) {
          return "tools";
        }
        return END;
      };

      // Build the graph
      const graph = new StateGraph(AgentState)
        .addNode("agent", agentNode)
        .addNode("tools", toolNode)
        .addEdge(START, "agent")
        .addConditionalEdges("agent", shouldContinue, { tools: "tools", [END]: END })
        .addEdge("tools", "agent")
        .compile();

      // Build context messages
      const contextMessages: BaseMessage[] = [new SystemMessage(this.buildSystemMessages(summary, hasCalendar, timezone))];

      for (const msg of history) {
        if (msg.role === "USER") {
          contextMessages.push(new HumanMessage(msg.content));
        } else if (msg.role === "ASSISTANT") {
          contextMessages.push(new AIMessage(msg.content));
        }
      }

      // Stream the graph
      let fullResponse = "";
      let tokenChunks = 0;
      let toolCallEvents = 0;

      try {
        const stream = await graph.stream(
          { messages: contextMessages },
          { streamMode: ["updates", "messages"], signal: streamAbort.signal },
        );

        for await (const item of stream) {
          const [mode, payload] = item as [string, unknown];

          if (mode === "messages") {
            const [message] = payload as [BaseMessage, Record<string, unknown>];
            const delta = textDeltaFromAiMessage(message);
            if (delta.length > 0) {
              tokenChunks += 1;
              fullResponse += delta;
              yield { type: "token" as const, content: delta };
            }
          } else if (mode === "updates") {
            const update = payload as {
              agent?: { messages: BaseMessage[] };
            };
            if (update.agent?.messages) {
              for (const msg of update.agent.messages) {
                const toolCalls = (msg as AIMessage).tool_calls;
                if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                  for (const tc of toolCalls) {
                    if (tc.name) {
                      toolCallEvents += 1;
                      this.logger.log(
                        `[ai-chat] agent tool_call userId=${userId} conversationId=${conversationId} tool=${tc.name}`,
                      );
                      yield { type: "tool_call" as const, toolName: tc.name };
                    }
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          this.logger.log(
            `[ai-chat] agent stream aborted userId=${userId} conversationId=${conversationId}`,
          );
          yield { type: "done" as const };
          return;
        }
        const msg = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        this.logger.error(
          `[ai-chat] agent graph stream error userId=${userId} conversationId=${conversationId}: ${msg}`,
          stack,
        );
        throw error;
      }

      this.logger.log(
        `[ai-chat] agent stream finished userId=${userId} conversationId=${conversationId} tokenChunks=${tokenChunks} toolCallEvents=${toolCallEvents} assistantChars=${fullResponse.length}`,
      );
      yield { type: "done" as const };

      // Save the assistant response
      if (fullResponse.length > 0) {
        await this.conversationService.addMessage(conversationId, "ASSISTANT", fullResponse);
      }
    } finally {
      this.activeStreamAbortControllers.delete(userId);
    }
  }
}
