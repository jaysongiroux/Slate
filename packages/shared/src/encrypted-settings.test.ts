import { describe, expect, it } from "vitest";
import {
  isEncryptedSettingKey,
  isMigrationSkippedSettingKey,
  ENCRYPTED_SETTING_KEY_DENYLIST,
} from "./encrypted-settings";

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

describe("isMigrationSkippedSettingKey", () => {
  it("skips token-bound extension namespaces wholesale", () => {
    expect(isMigrationSkippedSettingKey("linkwarden.instances")).toBe(true);
    expect(isMigrationSkippedSettingKey("forge.starredRepos")).toBe(true);
    expect(isMigrationSkippedSettingKey("forge.pinnedItems")).toBe(true);
    expect(isMigrationSkippedSettingKey("forge.savedSearches")).toBe(true);
    expect(isMigrationSkippedSettingKey("jira.instances")).toBe(true);
    expect(isMigrationSkippedSettingKey("jira.savedQueries")).toBe(true);
    expect(isMigrationSkippedSettingKey("homeAssistant.instances")).toBe(true);
  });

  it("skips per-extension enabled flags for token-bound extensions", () => {
    expect(isMigrationSkippedSettingKey("extensions.linkwardenEnabled")).toBe(true);
    expect(isMigrationSkippedSettingKey("extensions.forgeEnabled")).toBe(true);
    expect(isMigrationSkippedSettingKey("extensions.jiraEnabled")).toBe(true);
    expect(isMigrationSkippedSettingKey("extensions.homeAssistantEnabled")).toBe(true);
  });

  it("preserves user-data settings that are not server-bound", () => {
    expect(isMigrationSkippedSettingKey("keyboardShortcuts")).toBe(false);
    expect(isMigrationSkippedSettingKey("extensions.checklists")).toBe(false);
    expect(isMigrationSkippedSettingKey("extensions.checklistsEnabled")).toBe(false);
    expect(isMigrationSkippedSettingKey("extensions.checklistsSelected")).toBe(false);
    expect(isMigrationSkippedSettingKey("extensions.diagramsEnabled")).toBe(false);
    expect(isMigrationSkippedSettingKey("extensions.noteGraphEnabled")).toBe(false);
  });

  it("still covers everything isEncryptedSettingKey covered", () => {
    expect(isMigrationSkippedSettingKey("linkwarden.tokens")).toBe(true);
    expect(isMigrationSkippedSettingKey("future-extension.tokens")).toBe(true);
  });
});
