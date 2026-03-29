import { AIMessageChunk } from "@langchain/core/messages";

/**
 * Some chat providers attach a `done` flag on streamed chunks; merging with
 * AIMessageChunk.concat() then throws "field[done] already exists…". Strip it
 * before each concat so tool-calling streams stay stable.
 */
export function stripConflictingAiChunkFields(chunk: AIMessageChunk): AIMessageChunk {
  const ak =
    typeof chunk.additional_kwargs === "object" && chunk.additional_kwargs !== null
      ? { ...chunk.additional_kwargs }
      : {};
  const rm =
    typeof chunk.response_metadata === "object" && chunk.response_metadata !== null
      ? { ...chunk.response_metadata }
      : {};
  delete (ak as Record<string, unknown>).done;
  delete (rm as Record<string, unknown>).done;
  return new AIMessageChunk({
    ...chunk,
    additional_kwargs: ak,
    response_metadata: rm,
  });
}

export function concatAiMessageChunksSafe(
  acc: AIMessageChunk | undefined,
  chunk: AIMessageChunk,
): AIMessageChunk {
  const clean = stripConflictingAiChunkFields(chunk);
  if (!acc) {
    return clean;
  }
  return stripConflictingAiChunkFields(acc).concat(clean);
}
