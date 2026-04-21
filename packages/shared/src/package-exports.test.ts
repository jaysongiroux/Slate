import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HOME_ASSISTANT_ENABLED_SETTING_KEY,
  HOME_ASSISTANT_INSTANCES_SETTING_KEY,
  HOME_ASSISTANT_TOKENS_SETTING_KEY,
} from ".";

function getPackageRoot(): string {
  const currentFilePath = fileURLToPath(import.meta.url);
  return resolve(dirname(currentFilePath), "..");
}

function loadPackageJson(packageRoot: string): Record<string, unknown> {
  const packageJsonPath = resolve(packageRoot, "package.json");
  const contents = readFileSync(packageJsonPath, "utf8");
  return JSON.parse(contents) as Record<string, unknown>;
}

function assertFileExists(packageRoot: string, relativePath: string): void {
  const absolutePath = resolve(packageRoot, relativePath);
  expect(existsSync(absolutePath), `${relativePath} should exist`).toBe(true);
}

describe("shared package exports", () => {
  it("points to files that exist on disk", () => {
    const packageRoot = getPackageRoot();
    const packageJson = loadPackageJson(packageRoot);

    const main = packageJson.main;
    const module = packageJson.module;
    const types = packageJson.types;
    const exportsField = packageJson.exports as Record<string, unknown> | undefined;
    const rootExport = exportsField?.["."] as Record<string, unknown> | undefined;

    expect(typeof main).toBe("string");
    expect(typeof module).toBe("string");
    expect(typeof types).toBe("string");
    expect(rootExport).toBeDefined();
    expect(typeof rootExport?.import).toBe("string");
    expect(typeof rootExport?.require).toBe("string");
    expect(typeof rootExport?.types).toBe("string");

    assertFileExists(packageRoot, main as string);
    assertFileExists(packageRoot, module as string);
    assertFileExists(packageRoot, types as string);
    assertFileExists(packageRoot, rootExport?.import as string);
    assertFileExists(packageRoot, rootExport?.require as string);
    assertFileExists(packageRoot, rootExport?.types as string);
  });

  it("exposes a single-user sync contract instead of workspace-linked fields", () => {
    const packageRoot = getPackageRoot();
    const source = readFileSync(resolve(packageRoot, "src/index.ts"), "utf8");

    expect(source).toContain("export interface LocalLibraryProfile");
    expect(source).toContain("authenticatedUserId?: string;");
    expect(source).toContain("authenticatedEmail?: string;");
    expect(source).toContain("authenticatedDisplayName?: string;");
    expect(source).toContain("authenticatedIsAdmin?: boolean;");

    expect(source).not.toContain("export interface LocalWorkspaceProfile");
    expect(source).not.toContain("linkedWorkspaceId?: string;");
    expect(source).not.toContain("authenticatedWorkspaceId?: string;");
    expect(source).not.toContain("authenticatedWorkspaceName?: string;");
  });

  it("exports Home Assistant setting keys", () => {
    expect(HOME_ASSISTANT_ENABLED_SETTING_KEY).toBe("extensions.homeAssistantEnabled");
    expect(HOME_ASSISTANT_INSTANCES_SETTING_KEY).toBe("homeAssistant.instances");
    expect(HOME_ASSISTANT_TOKENS_SETTING_KEY).toBe("homeAssistant.tokens");
  });
});
