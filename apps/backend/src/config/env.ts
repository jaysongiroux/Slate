import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const candidatePaths = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "apps/backend/.env"),
  resolve(__dirname, "../../.env")
];

for (const envPath of candidatePaths) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: false });
    break;
  }
}

