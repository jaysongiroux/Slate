import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function deriveKey(keyRaw: string): Buffer {
  return createHash("sha256").update(keyRaw).digest();
}

/**
 * Encrypts a secret string using AES-256-GCM.
 *
 * Key is derived from `keyRaw` via SHA-256.
 * Returns the format `iv.tag.ciphertext` (all hex-encoded).
 * Uses a random 12-byte IV per call.
 */
export function encryptSecret(secret: string, keyRaw: string): string {
  const key = deriveKey(keyRaw);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
}

/**
 * Decrypts an encoded string produced by `encryptSecret`.
 *
 * Expects the format `iv.tag.ciphertext` (all hex-encoded).
 * Throws `Error('Invalid encrypted secret format')` if the format is wrong.
 */
export function decryptSecret(encoded: string, keyRaw: string): string {
  const parts = encoded.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted secret format");
  }

  const key = deriveKey(keyRaw);
  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = Buffer.from(parts[2], "hex");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  try {
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    throw new Error("Invalid encrypted secret format");
  }
}
