/**
 * Setting keys whose values are encrypted with the active backend's key.
 * Useless to migrate to a different backend — ciphertext can't be decrypted.
 */
export const ENCRYPTED_SETTING_KEY_DENYLIST: readonly string[] = [
  "linkwarden.tokens",
  "forge.tokens",
  "jira.tokens",
  "homeAssistant.tokens",
];

/**
 * Extension namespaces whose configuration is bound to per-server credentials.
 * Migrating instance URLs without their tokens leaves the user with broken
 * extensions calling out as `<extension> token not found`. Skip the whole
 * namespace and let the user reconfigure on the new server.
 */
const TOKEN_BOUND_EXTENSION_PREFIXES: readonly string[] = [
  "linkwarden.",
  "forge.",
  "jira.",
  "homeAssistant.",
];

/**
 * Per-extension enabled flags whose extensions are token-bound. We skip these
 * so the new server doesn't show the extension as enabled with no tokens.
 */
const TOKEN_BOUND_ENABLED_KEYS: readonly string[] = [
  "extensions.linkwardenEnabled",
  "extensions.forgeEnabled",
  "extensions.jiraEnabled",
  "extensions.homeAssistantEnabled",
];

export function isEncryptedSettingKey(key: string): boolean {
  if (ENCRYPTED_SETTING_KEY_DENYLIST.includes(key)) return true;
  if (key.endsWith(".tokens")) return true;
  return false;
}

/**
 * Returns true if the setting key should NOT be migrated between servers.
 * Covers both encrypted values and per-server-bound extension configuration
 * whose tokens are server-scoped.
 */
export function isMigrationSkippedSettingKey(key: string): boolean {
  if (isEncryptedSettingKey(key)) return true;
  if (TOKEN_BOUND_EXTENSION_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  if (TOKEN_BOUND_ENABLED_KEYS.includes(key)) return true;
  return false;
}
