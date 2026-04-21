import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const desktopRoot = new URL("../../", import.meta.url);

function readDesktopFile(relativePath) {
  return readFileSync(join(desktopRoot.pathname, relativePath), "utf8");
}

const bridgeMethods = [
  "getHomeAssistantInstances",
  "addHomeAssistantInstance",
  "updateHomeAssistantInstance",
  "removeHomeAssistantInstance",
  "testHomeAssistantConnection",
  "getHomeAssistantDashboards",
  "getHomeAssistantDashboard",
  "getHomeAssistantAreas",
  "getHomeAssistantDevices",
  "getHomeAssistantEntities",
  "getHomeAssistantEntity",
  "getHomeAssistantEntityHistory",
  "getHomeAssistantState",
  "controlHomeAssistantEntity",
  "resolveHomeAssistantCameraSnapshotUrl",
  "subscribeHomeAssistantEvents",
  "unsubscribeHomeAssistantEvents",
];

test("Home Assistant desktop bridge exposes each renderer IPC method", () => {
  const preload = readDesktopFile("electron/preload.mjs");
  const main = readDesktopFile("electron/main.mjs");
  const ipcCore = readDesktopFile("src/lib/api/ipc-core.ts");
  const apiIndex = readDesktopFile("src/lib/api/index.ts");

  for (const method of bridgeMethods) {
    const channel = `desktop:${method}`;
    assert.match(preload, new RegExp(`${method}:`), `preload should expose ${method}`);
    assert.match(preload, new RegExp(`invoke\\("${channel}"`), `preload should invoke ${channel}`);
    assert.match(
      main,
      new RegExp(`ipcMain\\.handle\\("${channel}"`),
      `main should handle ${channel}`,
    );
    assert.match(ipcCore, new RegExp(`${method}\\(`), `DesktopApi should include ${method}`);
  }

  assert.match(apiIndex, /export \* from "\.\/home-assistant-api";/);
});

test("Home Assistant HttpClient methods proxy through core REST endpoints", () => {
  const client = readDesktopFile("electron/services/http-client.mjs");

  for (const method of bridgeMethods) {
    assert.match(client, new RegExp(`async ${method}\\(`), `HttpClient should define ${method}`);
  }

  assert.match(client, /\/api\/home-assistant\/instances/);
  assert.match(client, /\/api\/home-assistant\/instances\/\$\{instanceId\}\/test/);
  assert.match(client, /\/api\/home-assistant\/\$\{instanceId\}\/dashboards/);
  assert.match(client, /\/api\/home-assistant\/\$\{instanceId\}\/areas/);
  assert.match(client, /\/api\/home-assistant\/\$\{instanceId\}\/devices/);
  assert.match(client, /\/api\/home-assistant\/\$\{instanceId\}\/entities/);
  assert.match(
    client,
    /\/api\/home-assistant\/\$\{instanceId\}\/entities\/\$\{encodeURIComponent\(entityId\)\}\/history/,
  );
  assert.match(client, /\/api\/home-assistant\/\$\{instanceId\}\/state/);
  assert.match(client, /\/api\/home-assistant\/\$\{instanceId\}\/control/);
  assert.match(
    client,
    /\/api\/home-assistant\/\$\{instanceId\}\/cameras\/\$\{encodeURIComponent\(entityId\)\}\/snapshot/,
  );
  assert.match(client, /\/api\/home-assistant\/\$\{instanceId\}\/events/);
  assert.match(client, /homeAssistantEventStreams/);
  assert.match(client, /home_assistant\.stream_error/);
  assert.match(client, /home_assistant\.stream_response_error/);
  assert.match(client, /home_assistant\.stream_request_failed/);
});
