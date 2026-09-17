import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();

const read = (relPath) => readFile(path.join(appRoot, relPath), "utf8");

test("the send-message contract carries the classified error fields", async () => {
  const ipcCore = await read("src/lib/api/ipc-core.ts");

  assert.match(ipcCore, /code\?: ChatErrorCode/);
  assert.match(ipcCore, /detail\?: string/);
  assert.match(ipcCore, /actionUrl\?: string/);
  assert.match(ipcCore, /retryable\?: boolean/);
  assert.match(ipcCore, /provider_no_credits/);
});

test("the retry flag is threaded from the chat UI down to the backend request", async () => {
  const [aiApi, ipcCore, preload, main] = await Promise.all([
    read("src/lib/api/ai-api.ts"),
    read("src/lib/api/ipc-core.ts"),
    read("electron/preload.mjs"),
    read("electron/main.mjs"),
  ]);

  assert.match(aiApi, /options\?:\s*\{\s*retry\?: boolean/s);
  assert.match(ipcCore, /options\?:\s*\{\s*retry\?: boolean/s);
  assert.match(preload, /options/);
  assert.match(main, /options\?\.retry/);
});

test("a failed turn becomes part of the transcript instead of transient banner state", async () => {
  const chatSidebar = await read("src/components/ChatSidebar.tsx");

  // The error is written into the message list, keyed by the same metadata the
  // backend persists, so a reload and a live failure render identically.
  assert.match(chatSidebar, /kind: "error"/);
  assert.match(chatSidebar, /retryable: event\.retryable/);
  // The old behaviour threw the turn away and stashed the text in local state.
  assert.doesNotMatch(chatSidebar, /setSendError\(event\.content/);
});

test("retrying a failed turn reuses the question already in history", async () => {
  const chatSidebar = await read("src/components/ChatSidebar.tsx");

  // The retry flag reaches the transport, and the question comes from history
  // rather than the composer.
  assert.match(chatSidebar, /\{ retry \}/);
  assert.match(chatSidebar, /handleSend\(\{ text: lastUserMessage\.content \}\)/);
  assert.match(chatSidebar, /onRetry/);
});

test("error notices render as their own message kind with details and an action", async () => {
  const [chatMessage, notice] = await Promise.all([
    read("src/components/ChatMessage.tsx"),
    read("src/components/chat/ChatErrorNotice.tsx"),
  ]);

  assert.match(chatMessage, /metadata\?\.kind === "error"/);
  assert.match(chatMessage, /ChatErrorNotice/);
  assert.match(notice, /TriangleAlert/);
  assert.match(notice, /Technical details/);
  assert.match(notice, /openExternal/);
  assert.match(notice, /onRetry/);
  // No emoji glyphs — the icon set is lucide.
  assert.doesNotMatch(notice, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});

test("chat message metadata typing knows about error notices", async () => {
  const chatHelpers = await read("src/components/chat/chat-helpers.ts");

  assert.match(chatHelpers, /retryable\?: boolean/);
  assert.match(chatHelpers, /actionUrl\?: string/);
});
