import type { Logger } from "@nestjs/common";
import type { StructuredToolInterface } from "@langchain/core/tools";

export type ToolLogContext = {
  userId: string;
  conversationId: string;
};

function jsonStringifySafe(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}

function summarizeToolInput(input: unknown): string {
  if (input == null) {
    return "null";
  }
  if (typeof input === "object") {
    try {
      const s = jsonStringifySafe(input);
      if (s.length > 400) {
        return `${s.slice(0, 400)}…(len=${s.length})`;
      }
      return s;
    } catch {
      return "[object]";
    }
  }
  const s = String(input);
  return s.length > 200 ? `${s.slice(0, 200)}…(len=${s.length})` : s;
}

function summarizeToolOutput(result: unknown): string {
  if (typeof result === "string") {
    return `chars=${result.length}`;
  }
  if (result == null) {
    return "null";
  }
  try {
    const s = jsonStringifySafe(result);
    return `jsonLen=${s.length}`;
  } catch {
    return "non-serializable";
  }
}

/**
 * Wraps each tool's `invoke` to log duration and rough I/O size for performance monitoring.
 * Mutates tool instances in place so LangGraph's ToolNode still receives the same references.
 */
export function wrapToolsWithPerformanceLogging(
  logger: Logger,
  tools: StructuredToolInterface[],
  ctx: ToolLogContext,
): StructuredToolInterface[] {
  for (const tool of tools) {
    const toolName = tool.name;
    const originalInvoke = tool.invoke.bind(tool) as StructuredToolInterface["invoke"];

    (tool as { invoke: StructuredToolInterface["invoke"] }).invoke = async (
      input: Parameters<StructuredToolInterface["invoke"]>[0],
      options?: Parameters<StructuredToolInterface["invoke"]>[1],
    ) => {
      const t0 = performance.now();
      const inputSummary = summarizeToolInput(input);
      logger.log(
        `[agent-tool] start tool=${toolName} userId=${ctx.userId} conversationId=${ctx.conversationId} input=${inputSummary}`,
      );
      try {
        const result = await originalInvoke(input, options);
        const ms = Number((performance.now() - t0).toFixed(2));
        logger.log(
          `[agent-tool] ok tool=${toolName} userId=${ctx.userId} conversationId=${ctx.conversationId} durationMs=${ms} ${summarizeToolOutput(result)}`,
        );
        return result;
      } catch (err) {
        const ms = Number((performance.now() - t0).toFixed(2));
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `[agent-tool] error tool=${toolName} userId=${ctx.userId} conversationId=${ctx.conversationId} durationMs=${ms} message=${msg}`,
        );
        throw err;
      }
    };
  }
  return tools;
}
