/**
 * Preset model IDs shown in the desktop AI settings UI. Users can still pick "Other" and type any model string.
 * Embedding vectors are stored zero-padded to 4096 in Postgres; native sizes below are hints for the UI only.
 */

export const CHAT_MODEL_PRESETS: Record<string, string[]> = {
  OPENAI: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o3-mini"],
  ANTHROPIC: [
    "claude-sonnet-4-20250514",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-20250514",
  ],
  OLLAMA: [
    "llama3.1",
    "mistral",
    "mixtral",
    "qwen2.5",
    "qwen3:1.7b",
    "qwen3:3.2b",
    "qwen3:6.7b",
    "qwen3:8b",
    "qwen3:14b",
    "qwen3:30b",
    "qwen3-next",
    "qwen3-coder",
  ],
  /** DashScope / other OpenAI-compatible Qwen endpoints (model id is sent as-is). */
  OPENAI_COMPATIBLE: [
    "qwen3-max",
    "qwen3-8b",
    "qwen3-14b",
    "qwen3-32b",
    "qwen-plus",
    "qwen-turbo",
    "qwen-max",
  ],
};

export const EMBEDDING_MODEL_PRESETS: Record<string, string[]> = {
  OPENAI: ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"],
  OLLAMA: [
    "nomic-embed-text",
    "mxbai-embed-large",
    "all-minilm",
    "qwen3-embedding",
    "qwen3-embedding:0.6b",
    "qwen3-embedding:4b",
    "qwen3-embedding:8b",
  ],
  OPENAI_COMPATIBLE: ["text-embedding-v4", "text-embedding-v3", "text-embedding-v2"],
};

/**
 * Typical native embedding width for a model id (before zero-padding to 4096 in Slate).
 * Undefined = unknown or provider-dependent; Qwen3 Embedding on Ollama supports 32–4096 with a common default of 4096.
 */
const EMBEDDING_NATIVE_DIMS_EXACT: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
  "nomic-embed-text": 768,
  "mxbai-embed-large": 1024,
  "all-minilm": 384,
  /** DashScope defaults (dimensions can often be configured per request). */
  "text-embedding-v4": 1024,
  "text-embedding-v3": 1024,
  "text-embedding-v2": 1536,
};

export function getEmbeddingNativeDimensionsHint(modelId: string): number | undefined {
  const id = modelId.trim();
  if (!id) {
    return undefined;
  }
  const exact = EMBEDDING_NATIVE_DIMS_EXACT[id];
  if (exact !== undefined) {
    return exact;
  }
  if (id.startsWith("qwen3-embedding")) {
    return 4096;
  }
  return undefined;
}
