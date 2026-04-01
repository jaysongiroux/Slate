import { decryptSecret, encryptSecret } from "./encryption.util";

const TEST_KEY = "test-encryption-key-for-unit-tests";
const TEST_SECRET = "sk-supersecretapikey1234567890";

describe("encryptSecret / decryptSecret", () => {
  describe("round-trip", () => {
    it("decrypts back to the original secret", () => {
      const encoded = encryptSecret(TEST_SECRET, TEST_KEY);
      const result = decryptSecret(encoded, TEST_KEY);
      expect(result).toBe(TEST_SECRET);
    });

    it("works with an empty string secret", () => {
      const encoded = encryptSecret("", TEST_KEY);
      const result = decryptSecret(encoded, TEST_KEY);
      expect(result).toBe("");
    });

    it("works with unicode content", () => {
      const secret = "my-key-🔑-日本語";
      const encoded = encryptSecret(secret, TEST_KEY);
      const result = decryptSecret(encoded, TEST_KEY);
      expect(result).toBe(secret);
    });
  });

  describe("different ciphertexts for same input (random IV)", () => {
    it("produces different encoded values on each call", () => {
      const first = encryptSecret(TEST_SECRET, TEST_KEY);
      const second = encryptSecret(TEST_SECRET, TEST_KEY);
      expect(first).not.toBe(second);
    });

    it("encoded format has three dot-separated hex parts", () => {
      const encoded = encryptSecret(TEST_SECRET, TEST_KEY);
      const parts = encoded.split(".");
      expect(parts).toHaveLength(3);
      // Each part should be non-empty hex
      for (const part of parts) {
        expect(part).toMatch(/^[0-9a-f]+$/);
      }
    });
  });

  describe("throw on tampered ciphertext", () => {
    it("throws when the ciphertext is modified", () => {
      const encoded = encryptSecret(TEST_SECRET, TEST_KEY);
      const parts = encoded.split(".");
      // Flip the last character of the ciphertext
      const tampered = parts[2].slice(0, -1) + (parts[2].endsWith("f") ? "0" : "f");
      const tamperedEncoded = `${parts[0]}.${parts[1]}.${tampered}`;
      expect(() => decryptSecret(tamperedEncoded, TEST_KEY)).toThrow(
        "Invalid encrypted secret format",
      );
    });

    it("throws when the auth tag is modified", () => {
      const encoded = encryptSecret(TEST_SECRET, TEST_KEY);
      const parts = encoded.split(".");
      // Flip the last character of the tag
      const tamperedTag = parts[1].slice(0, -1) + (parts[1].endsWith("f") ? "0" : "f");
      const tamperedEncoded = `${parts[0]}.${tamperedTag}.${parts[2]}`;
      expect(() => decryptSecret(tamperedEncoded, TEST_KEY)).toThrow(
        "Invalid encrypted secret format",
      );
    });

    it("throws when the wrong key is used", () => {
      const encoded = encryptSecret(TEST_SECRET, TEST_KEY);
      expect(() => decryptSecret(encoded, "wrong-key")).toThrow("Invalid encrypted secret format");
    });
  });

  describe("throw on invalid format", () => {
    it("throws on empty string", () => {
      expect(() => decryptSecret("", TEST_KEY)).toThrow("Invalid encrypted secret format");
    });

    it("throws when fewer than three dot-separated parts", () => {
      expect(() => decryptSecret("abc.def", TEST_KEY)).toThrow("Invalid encrypted secret format");
    });

    it("throws when more than three dot-separated parts", () => {
      expect(() => decryptSecret("a.b.c.d", TEST_KEY)).toThrow("Invalid encrypted secret format");
    });

    it("throws on a plaintext string that is not encrypted", () => {
      expect(() => decryptSecret("not-encrypted-at-all", TEST_KEY)).toThrow(
        "Invalid encrypted secret format",
      );
    });
  });
});
