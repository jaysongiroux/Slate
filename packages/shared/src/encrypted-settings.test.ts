import { describe, expect, it } from "vitest";
import { isEncryptedSettingKey, ENCRYPTED_SETTING_KEY_DENYLIST } from "./encrypted-settings";

describe("isEncryptedSettingKey", () => {
  it("returns true for known token keys", () => {
    expect(isEncryptedSettingKey("linkwarden.tokens")).toBe(true);
    expect(isEncryptedSettingKey("forge.tokens")).toBe(true);
    expect(isEncryptedSettingKey("jira.tokens")).toBe(true);
    expect(isEncryptedSettingKey("homeAssistant.tokens")).toBe(true);
  });

  it("returns true for any key ending in .tokens", () => {
    expect(isEncryptedSettingKey("future-extension.tokens")).toBe(true);
  });

  it("returns false for plain extension keys", () => {
    expect(isEncryptedSettingKey("extensions.diagramsEnabled")).toBe(false);
    expect(isEncryptedSettingKey("forge.instances")).toBe(false);
    expect(isEncryptedSettingKey("keyboardShortcuts")).toBe(false);
  });

  it("exposes a denylist that covers the known cases", () => {
    expect(ENCRYPTED_SETTING_KEY_DENYLIST).toContain("linkwarden.tokens");
    expect(ENCRYPTED_SETTING_KEY_DENYLIST).toContain("forge.tokens");
    expect(ENCRYPTED_SETTING_KEY_DENYLIST).toContain("jira.tokens");
    expect(ENCRYPTED_SETTING_KEY_DENYLIST).toContain("homeAssistant.tokens");
  });
});
