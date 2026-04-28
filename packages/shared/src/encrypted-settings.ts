/**
 * Setting keys whose values are encrypted with the active backend's key.
 * These must NOT be migrated between servers — the ciphertext is useless
 * to any backend other than the one that wrote it.
 */
export const ENCRYPTED_SETTING_KEY_DENYLIST: readonly string[] = [
  "linkwarden.tokens",
  "forge.tokens",
  "jira.tokens",
  "homeAssistant.tokens",
];

export function isEncryptedSettingKey(key: string): boolean {
  if (ENCRYPTED_SETTING_KEY_DENYLIST.includes(key)) return true;
  return key.endsWith(".tokens");
}
