import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ModelProviderService } from "./model-provider.service";
import { ConversationService } from "./conversation.service";
import { SearchService } from "../search/search.service";
import { createVectorSearchTool } from "./tools/vector-search.tool";
import { createTitleSearchTool } from "./tools/title-search.tool";
import { createGetNoteTool } from "./tools/get-note.tool";
import { createListRecentTool } from "./tools/list-recent.tool";
import { createFullTextSearchTool } from "./tools/full-text-search.tool";
import { StateGraph, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { Annotation } from "@langchain/langgraph";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  BaseMessage,
} from "@langchain/core/messages";

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

export interface StreamEvent {
  type: "token" | "tool_call" | "done";
  content?: string;
  toolName?: string;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modelProvider: ModelProviderService,
    private readonly conversationService: ConversationService,
    private readonly searchService: SearchService,
  ) {}

  buildSystemMessages(summary: string | null): string {
    let prompt =
      "You are a helpful AI assistant for a note-taking application called Slate. You have access to the user's personal notes and can search, retrieve, and answer questions about them. When answering questions, cite the source notes by their title. Be concise and helpful.";

    if (summary) {
      prompt += `\n\nHere is a summary of the earlier part of this conversation:\n${summary}`;
    }

    return prompt;
  }

  async *streamResponse(
    userId: string,
    conversationId: string,
    userMessage: string,
  ): AsyncGenerator<StreamEvent> {
    // Save the user message
    await this.conversationService.addMessage(conversationId, "USER", userMessage);

    // Load conversation context
    const { summary, messages: history } =
      await this.conversationService.getMessagesForContext(conversationId);

    // Get models
    const chatModel = await this.modelProvider.getChatModel(userId);
    const embeddingModel = await this.modelProvider.getEmbeddingModel(userId);

    // Create tools
    const tools = [
      createVectorSearchTool(this.prisma, embeddingModel, userId),
      createTitleSearchTool(this.prisma, userId),
      createGetNoteTool(this.prisma, userId),
      createListRecentTool(this.prisma, userId),
      createFullTextSearchTool(this.searchService, userId),
    ];

    // Bind tools to model
    const modelWithTools = (chatModel as any).bindTools(tools);

    // Define agent node
    const agentNode = async (state: typeof AgentState.State) => {
      const response = await modelWithTools.invoke(state.messages);
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
        { streamMode: "updates" },
      );

      for await (const update of stream) {
        // Process agent node updates
        if (update.agent) {
          const agentMessages = update.agent.messages;
          for (const msg of agentMessages) {
            // Check for tool calls
            if (
              "tool_calls" in msg &&
              Array.isArray(msg.tool_calls) &&
              msg.tool_calls.length > 0
            ) {
              for (const tc of msg.tool_calls) {
                yield { type: "tool_call" as const, toolName: tc.name };
              }
            }

            // Check for text content
            if (typeof msg.content === "string" && msg.content.length > 0) {
              fullResponse += msg.content;
              yield { type: "token" as const, content: msg.content };
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
  }
}
