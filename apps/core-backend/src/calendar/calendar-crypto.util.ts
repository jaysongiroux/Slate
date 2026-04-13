import { createHash } from "node:crypto";
import { decryptSecret, encryptSecret } from "../ai/encryption.util";

export function encryptCalendarSecret(secret: string, keyRaw: string): string {
  return encryptSecret(secret, keyRaw);
}

export function decryptCalendarSecret(encoded: string, keyRaw: string): string {
  return decryptSecret(encoded, keyRaw);
}

export function hashCalendarSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
