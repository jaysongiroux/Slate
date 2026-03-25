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

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

export interface StreamEvent {
  type: "token" | "tool_call" | "done"
    | "note_create_start" | "note_edit_start" | "note_delta" | "note_done";
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
  private readonly activeStreams = new Map<string, boolean>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly modelProvider: ModelProviderService,
    private readonly aiConfigService: AiConfigService,
    private readonly conversationService: ConversationService,
    private readonly searchService: SearchService,
    private readonly crdtService: CrdtService,
    private readonly documentsService: DocumentsService,
  ) {}

  buildSystemMessages(summary: string | null): string {
    let prompt =
      "You are a helpful AI assistant for a note-taking application called Slate. You have access to the user's personal notes and can search, retrieve, and answer questions about them. When answering questions, cite the source notes by their title. Be concise and helpful.";

    prompt +=
      "\n\nYou can also create new notes and edit existing ones. When a user asks you to write, draft, create, or modify a note, use the create_note or edit_note tools. For create_note, provide a clear title and detailed instructions about what to write. For edit_note, first use search tools to find the note's document ID, then provide the ID and precise instructions for the changes. Prefer targeted edits for long notes and full rewrites for short ones.";

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
  ): AsyncGenerator<StreamEvent> {
    if (this.activeStreams.get(userId)) {
      yield { type: "done" as const };
      return;
    }
    this.activeStreams.set(userId, true);
    try {
    // Save the user message
    await this.conversationService.addMessage(conversationId, "USER", userMessage);

    // Load conversation context
    const { summary, messages: history } =
      await this.conversationService.getMessagesForContext(conversationId);

    // Get models
    const chatModel = await this.modelProvider.getChatModel(userId);
    const embeddingModel =
      await this.modelProvider.getEmbeddingModelOrNull(userId);
    const aiConfig =
      embeddingModel !== null ? await this.aiConfigService.getConfig(userId) : null;
    const embeddingModelId = aiConfig?.embeddingModel ?? null;

    // Create tools (vector search only when embeddings are configured)
    const tools = [
      ...(embeddingModel && embeddingModelId
        ? [createVectorSearchTool(this.prisma, embeddingModel, userId, embeddingModelId)]
        : []),
      createTitleSearchTool(this.prisma, userId),
      createGetNoteTool(this.prisma, userId),
      createListRecentTool(this.prisma, userId),
      createFullTextSearchTool(this.searchService, userId),
      createCreateNoteTool(
        this.prisma, this.crdtService, this.documentsService,
        userId, chatModel, emitNoteEvent,
      ),
      createEditNoteTool(
        this.prisma, this.crdtService, this.documentsService,
        userId, chatModel, emitNoteEvent,
      ),
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
          acc = acc ? acc.concat(chunk) : chunk;
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
    const contextMessages: BaseMessage[] = [
      new SystemMessage(this.buildSystemMessages(summary)),
    ];

    for (const msg of history) {
      if (msg.role === "USER") {
        contextMessages.push(new HumanMessage(msg.content));
      } else if (msg.role === "ASSISTANT") {
        contextMessages.push(new AIMessage(msg.content));
      }
    }

    // Stream the graph
    let fullResponse = "";

    try {
      const stream = await graph.stream(
        { messages: contextMessages },
        { streamMode: ["updates", "messages"] },
      );

      for await (const item of stream) {
        const [mode, payload] = item as [string, unknown];

        if (mode === "messages") {
          const [message] = payload as [BaseMessage, Record<string, unknown>];
          const delta = textDeltaFromAiMessage(message);
          if (delta.length > 0) {
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
                    yield { type: "tool_call" as const, toolName: tc.name };
                  }
                }
              }
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(`Agent stream error: ${error}`);
      throw error;
    }

    yield { type: "done" as const };

    // Save the assistant response
    if (fullResponse.length > 0) {
      await this.conversationService.addMessage(
        conversationId,
        "ASSISTANT",
        fullResponse,
      );
    }
    } finally {
      this.activeStreams.delete(userId);
    }
  }
}
