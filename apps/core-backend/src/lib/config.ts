import type { AppConfig } from "./types";

export function createConfig(): AppConfig {
  return {
    get(key: string, defaultValue?: string): string {
      return process.env[key] ?? defaultValue ?? "";
    },
  };
}
