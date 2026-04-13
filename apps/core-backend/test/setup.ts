/**
 * Jest global setup — runs before every test file.
 *
 * Loads .env.test (if present), then promotes TEST_DATABASE_URL → DATABASE_URL
 * so integration tests hit the dedicated test database.
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "../.env.test"), override: false });

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
