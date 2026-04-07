import { strict as assert } from "node:assert";
import { test, mock } from "node:test";
import { HttpClient } from "./http-client.mjs";

function makeStore(settings = {}) {
  const data = {
    backendEndpoint: "localhost:4000",
    accessToken: "test-token",
    refreshToken: "refresh-token",
    ...settings,
  };
  return {
    getSetting: (key, fallback = null) => data[key] ?? fallback,
    setSetting: (key, value) => {
      data[key] = value;
    },
  };
}

function makeMockResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

test("checkConnection: returns true when health endpoint returns ok", async (t) => {
  const mockFetch = t.mock.fn(async () => makeMockResponse('{"ok":true}'));
  global.fetch = mockFetch;
  const client = new HttpClient({ metadataStore: makeStore() });
  const result = await client.checkConnection("localhost:4000");
  assert.equal(result, true);
  const url = mockFetch.mock.calls[0].arguments[0];
  assert.ok(url.includes("/api/health"), "should call health endpoint");
});

test("get: attaches Bearer token from metadata store", async (t) => {
  const mockFetch = t.mock.fn(async () => makeMockResponse('{"providers":[]}'));
  global.fetch = mockFetch;
  const client = new HttpClient({ metadataStore: makeStore() });
  await client.get("/api/auth/providers");
  const init = mockFetch.mock.calls[0].arguments[1];
  assert.equal(init.headers["Authorization"], "Bearer test-token");
});

test("post: sends JSON body", async (t) => {
  const mockFetch = t.mock.fn(async () => makeMockResponse('{"id":"c1"}'));
  global.fetch = mockFetch;
  const client = new HttpClient({ metadataStore: makeStore() });
  await client.post("/api/ai/conversations", {});
  const init = mockFetch.mock.calls[0].arguments[1];
  assert.equal(init.method, "POST");
  assert.equal(init.headers["Content-Type"], "application/json");
});

test("baseUrl: normalizes endpoint to http URL", () => {
  const client = new HttpClient({
    metadataStore: makeStore({ backendEndpoint: "myserver.local:4000" }),
  });
  assert.equal(client.baseUrl(), "http://myserver.local:4000");
});

test("baseUrl: converts legacy gRPC port :50051 to :4000", () => {
  const client = new HttpClient({
    metadataStore: makeStore({ backendEndpoint: "localhost:50051" }),
  });
  assert.equal(client.baseUrl(), "http://localhost:4000");
});
