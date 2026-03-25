import { describe, expect, it } from "vitest";
import {
  EMBEDDING_MODEL_PRESETS,
  getEmbeddingNativeDimensionsHint,
} from "./ai-presets";

describe("ai-presets", () => {
  it("includes qwen3-embedding variants in Ollama embedding presets", () => {
    const ollama = EMBEDDING_MODEL_PRESETS.OLLAMA;
    expect(ollama).toContain("qwen3-embedding");
    expect(ollama).toContain("qwen3-embedding:8b");
  });

  it("hints 4096 for qwen3-embedding model ids", () => {
    expect(getEmbeddingNativeDimensionsHint("qwen3-embedding")).toBe(4096);
    expect(getEmbeddingNativeDimensionsHint("qwen3-embedding:0.6b")).toBe(4096);
  });

  it("hints OpenAI and DashScope embedding sizes", () => {
    expect(getEmbeddingNativeDimensionsHint("text-embedding-3-small")).toBe(1536);
    expect(getEmbeddingNativeDimensionsHint("text-embedding-v4")).toBe(1024);
  });
});
