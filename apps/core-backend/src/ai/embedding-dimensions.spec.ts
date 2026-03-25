import {
  EMBEDDING_VECTOR_DIMENSIONS,
  padEmbeddingToMax,
} from "./embedding-dimensions";

describe("embedding-dimensions", () => {
  describe("EMBEDDING_VECTOR_DIMENSIONS", () => {
    it("is 4096", () => {
      expect(EMBEDDING_VECTOR_DIMENSIONS).toBe(4096);
    });
  });

  describe("padEmbeddingToMax", () => {
    it("returns a copy when length is already 4096", () => {
      const input = Array.from({ length: 4096 }, (_, i) => i * 1e-6);
      const out = padEmbeddingToMax(input);
      expect(out).toHaveLength(4096);
      expect(out).not.toBe(input);
      expect(out[0]).toBe(0);
      expect(out[4095]).toBeCloseTo(4095 * 1e-6);
    });

    it("pads length 1536 with trailing zeros to 4096", () => {
      const input = Array.from({ length: 1536 }, (_, i) => i / 1536);
      const out = padEmbeddingToMax(input);
      expect(out).toHaveLength(4096);
      expect(out[0]).toBe(0);
      expect(out[1535]).toBeCloseTo(1535 / 1536);
      expect(out[1536]).toBe(0);
      expect(out[4095]).toBe(0);
    });

    it("throws when length is 0", () => {
      expect(() => padEmbeddingToMax([])).toThrow(/empty/i);
    });

    it("throws when length exceeds 4096", () => {
      const input = Array.from({ length: 4097 }, () => 0);
      expect(() => padEmbeddingToMax(input)).toThrow(/4097/);
      expect(() => padEmbeddingToMax(input)).toThrow(/4096/);
    });

    it("throws on non-finite values", () => {
      expect(() => padEmbeddingToMax([1, NaN, 2])).toThrow(/non-finite/);
      expect(() => padEmbeddingToMax([1, Infinity])).toThrow(/non-finite/);
    });
  });
});
