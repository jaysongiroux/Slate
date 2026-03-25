import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { AIMessageChunk } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { ChatOllama } from "@langchain/ollama";

/**
 * LangChain's ChatOllama uses a non-streaming request whenever tools are bound
 * (@langchain/ollama _streamResponseChunks: stream: false with tools).
 * Ollama's chat API does support streaming with tools; this subclass enables it
 * so token callbacks fire and the desktop UI can stream output.
 */
type OllamaMessageUtils = {
  convertToOllamaMessages: (messages: BaseMessage[]) => unknown[];
  convertOllamaMessagesToLangChain: (
    message: {
      content?: string;
      tool_calls?: Array<{
        function: { name: string; arguments: string | Record<string, unknown> };
      }>;
    },
    extra?: {
      responseMetadata?: Record<string, unknown>;
      usageMetadata?: Record<string, unknown>;
    },
  ) => AIMessageChunk;
};

let ollamaUtils: OllamaMessageUtils | undefined;

/**
 * Load @langchain/ollama message helpers via CommonJS `utils.cjs`.
 * Dynamic `import(file://.../utils.js)` fails under Nest's CJS output on some Node versions.
 */
function getOllamaUtils(): OllamaMessageUtils {
  if (!ollamaUtils) {
    const nodeRequire = createRequire(__filename);
    const ollamaPkgRoot = dirname(
      nodeRequire.resolve("@langchain/ollama/package.json"),
    );
    ollamaUtils = nodeRequire(
      join(ollamaPkgRoot, "dist", "utils.cjs"),
    ) as OllamaMessageUtils;
  }
  return ollamaUtils;
}

export class StreamingChatOllama extends ChatOllama {
  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: Record<string, unknown> | undefined,
    runManager: { handleLLMNewToken?: (t: string) => Promise<unknown> } | undefined,
  ): AsyncGenerator<ChatGenerationChunk> {
    if (this.checkOrPullModel) {
      if (
        !(await (this as unknown as { checkModelExistsOnMachine(m: string): Promise<boolean> }).checkModelExistsOnMachine(
          this.model,
        ))
      ) {
        await this.pull(this.model, { logProgress: true });
      }
    }

    const { convertToOllamaMessages, convertOllamaMessagesToLangChain } =
      getOllamaUtils();

    const params = this.invocationParams(options);
    const ollamaMessages = convertToOllamaMessages(messages);
    const usageMetadata = {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };

    if (params.tools && params.tools.length > 0) {
      const stream = await this.client.chat({
        ...params,
        messages: ollamaMessages as Parameters<typeof this.client.chat>[0]["messages"],
        stream: true,
      });

      let lastMetadata: Record<string, unknown> | undefined;
      for await (const chunk of stream) {
        if (options?.signal && (options.signal as AbortSignal).aborted) {
          this.client.abort();
        }
        const { message: responseMessage, ...rest } = chunk;
        usageMetadata.input_tokens += rest.prompt_eval_count ?? 0;
        usageMetadata.output_tokens += rest.eval_count ?? 0;
        usageMetadata.total_tokens =
          usageMetadata.input_tokens + usageMetadata.output_tokens;
        lastMetadata = rest as Record<string, unknown>;

        yield new ChatGenerationChunk({
          text: responseMessage.content ?? "",
          message: convertOllamaMessagesToLangChain(responseMessage, {
            responseMetadata: rest,
            usageMetadata: { ...usageMetadata },
          }),
        });
        await runManager?.handleLLMNewToken?.(responseMessage.content ?? "");
      }

      yield new ChatGenerationChunk({
        text: "",
        message: new AIMessageChunk({
          content: "",
          response_metadata: lastMetadata,
          usage_metadata: usageMetadata,
        }),
      });
      return;
    }

    const parentGen = (
      ChatOllama.prototype as unknown as {
        _streamResponseChunks(
          this: StreamingChatOllama,
          m: BaseMessage[],
          o: unknown,
          r: typeof runManager,
        ): AsyncGenerator<ChatGenerationChunk>;
      }
    )._streamResponseChunks.call(this, messages, options, runManager);
    yield* parentGen;
  }
}
