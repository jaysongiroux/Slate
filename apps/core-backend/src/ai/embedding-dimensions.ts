/** Fixed pgvector column width; shorter model outputs are zero-padded. */
export const EMBEDDING_VECTOR_DIMENSIONS = 4096;

/**
 * Pads `values` to `EMBEDDING_VECTOR_DIMENSIONS` with trailing zeros.
 * Vectors longer than the max are rejected.
 */
export function padEmbeddingToMax(values: number[]): number[] {
  if (values.length === 0) {
    throw new Error("Embedding vector is empty");
  }
  if (values.length > EMBEDDING_VECTOR_DIMENSIONS) {
    throw new Error(
      `Embedding has ${values.length} dimensions; maximum supported is ${EMBEDDING_VECTOR_DIMENSIONS}`,
    );
  }
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      throw new Error(`Embedding contains non-finite value at index ${i}`);
    }
  }
  if (values.length === EMBEDDING_VECTOR_DIMENSIONS) {
    return values.slice();
  }
  const out = new Array<number>(EMBEDDING_VECTOR_DIMENSIONS);
  for (let i = 0; i < values.length; i++) {
    out[i] = values[i];
  }
  for (let i = values.length; i < EMBEDDING_VECTOR_DIMENSIONS; i++) {
    out[i] = 0;
  }
  return out;
}
