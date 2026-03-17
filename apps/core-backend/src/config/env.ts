import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const isTest = process.env.NODE_ENV === "test";

const candidatePaths = [
  ...(isTest
    ? [
        resolve(process.cwd(), ".env.test"),
        resolve(process.cwd(), "apps/core-backend/.env.test"),
        resolve(__dirname, "../../.env.test"),
      ]
    : []),
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "apps/core-backend/.env"),
  resolve(__dirname, "../../.env"),
];

for (const envPath of candidatePaths) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: false });
    break;
  }
}

export function envFlag(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
