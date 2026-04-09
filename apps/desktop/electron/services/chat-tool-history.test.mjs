import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();

test("persisted chat tool-call messages are passed through metadata and rendered separately", async () => {
  const [apiSource, chatSidebarSource, chatMessageSource] = await Promise.all([
    readFile(path.join(appRoot, "src/lib/api.ts"), "utf8"),
    readFile(path.join(appRoot, "src/components/ChatSidebar.tsx"), "utf8"),
    readFile(path.join(appRoot, "src/components/ChatMessage.tsx"), "utf8"),
  ]);

  assert.match(apiSource, /metadata\?:\s*\{/);
  assert.match(chatSidebarSource, /metadata:\s*m\.metadata \?\? null/);
  assert.match(chatSidebarSource, /metadata=\{msg\.metadata\}/);
  assert.match(chatMessageSource, /metadata\?\.kind === "tool_call"/);
  assert.match(chatMessageSource, /italic leading-snug text-muted/);
});
