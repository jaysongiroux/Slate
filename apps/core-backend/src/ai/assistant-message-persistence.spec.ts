import { createAssistantMessagePersistence } from "./assistant-message-persistence";

describe("createAssistantMessagePersistence", () => {
  it("keeps the full assistant reply when no tool calls occur", () => {
    const persistence = createAssistantMessagePersistence();

    persistence.pushToken("Hello");
    persistence.pushToken(" world");

    expect(persistence.finalize()).toEqual([
      {
        role: "ASSISTANT",
        content: "Hello world",
      },
    ]);
  });

  it("discards pre-tool assistant text and persists the tool call plus final reply", () => {
    const persistence = createAssistantMessagePersistence();

    persistence.pushToken("Internal preamble");
    persistence.recordToolCall("edit_note", "call-1");
    persistence.pushToken("Final answer");

    expect(persistence.finalize()).toEqual([
      {
        role: "ASSISTANT",
        content: "Using tool: edit_note…",
        metadata: {
          kind: "tool_call",
          toolName: "edit_note",
        },
      },
      {
        role: "ASSISTANT",
        content: "Final answer",
      },
    ]);
  });

  it("keeps only the final assistant segment after multiple tool calls", () => {
    const persistence = createAssistantMessagePersistence();

    persistence.pushToken("First draft");
    persistence.recordToolCall("title_search", "call-1");
    persistence.pushToken("Second draft");
    persistence.recordToolCall("get_note", "call-2");
    persistence.pushToken("Resolved answer");

    expect(persistence.finalize()).toEqual([
      {
        role: "ASSISTANT",
        content: "Using tool: title_search…",
        metadata: {
          kind: "tool_call",
          toolName: "title_search",
        },
      },
      {
        role: "ASSISTANT",
        content: "Using tool: get_note…",
        metadata: {
          kind: "tool_call",
          toolName: "get_note",
        },
      },
      {
        role: "ASSISTANT",
        content: "Resolved answer",
      },
    ]);
  });
});
