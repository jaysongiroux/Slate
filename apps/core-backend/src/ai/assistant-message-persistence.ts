export type PersistedAssistantMessage = {
  role: "ASSISTANT";
  content: string;
  metadata?: {
    kind: "tool_call";
    toolName: string;
  };
};

export function createAssistantMessagePersistence() {
  const persistedMessages: PersistedAssistantMessage[] = [];
  const seenToolCalls = new Set<string>();
  let currentAssistantSegment = "";

  return {
    pushToken(text: string) {
      currentAssistantSegment += text;
    },

    recordToolCall(toolName: string, toolCallId?: string) {
      currentAssistantSegment = "";

      const dedupeKey = toolCallId?.trim() || `${toolName}:${persistedMessages.length}`;
      if (seenToolCalls.has(dedupeKey)) {
        return;
      }
      seenToolCalls.add(dedupeKey);

      persistedMessages.push({
        role: "ASSISTANT",
        content: `Using tool: ${toolName}…`,
        metadata: {
          kind: "tool_call",
          toolName,
        },
      });
    },

    finalize(): PersistedAssistantMessage[] {
      if (currentAssistantSegment.length > 0) {
        persistedMessages.push({
          role: "ASSISTANT",
          content: currentAssistantSegment,
        });
      }
      return persistedMessages;
    },
  };
}
