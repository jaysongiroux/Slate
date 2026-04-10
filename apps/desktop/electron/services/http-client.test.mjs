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

test("checkConnection: returns false when health endpoint is unavailable", async (t) => {
  const mockFetch = t.mock.fn(async () => makeMockResponse('{"ok":false}', 503));
  global.fetch = mockFetch;
  const client = new HttpClient({ metadataStore: makeStore() });
  const result = await client.checkConnection("localhost:4000");
  assert.equal(result, false);
});

test("getBackendStatus: retries startup health checks before reporting offline", async (t) => {
  let callCount = 0;
  const mockFetch = t.mock.fn(async (url) => {
    callCount += 1;
    if (callCount === 1) {
      throw new Error("socket not ready");
    }
    if (String(url).includes("/api/health")) {
      return makeMockResponse('{"ok":true}');
    }
    return makeMockResponse(
      '{"providers":[{"id":"password","label":"Password","type":"password"}]}',
    );
  });
  global.fetch = mockFetch;
  const client = new HttpClient({ metadataStore: makeStore() });
  client._sleep = async () => {};

  const result = await client.getBackendStatus("localhost:4000", {
    retries: 1,
    retryDelayMs: 0,
  });

  assert.deepEqual(result, {
    backendReachable: true,
    authProviders: [{ id: "password", label: "Password", type: "password" }],
  });
  assert.equal(mockFetch.mock.calls.length, 3);
});

test("getBackendStatus: treats healthy backend as reachable even when providers fail", async (t) => {
  const mockFetch = t.mock.fn(async (url) => {
    if (String(url).includes("/api/health")) {
      return makeMockResponse('{"ok":true}');
    }
    throw new Error("providers unavailable");
  });
  global.fetch = mockFetch;
  const client = new HttpClient({ metadataStore: makeStore() });

  const result = await client.getBackendStatus("localhost:4000", {
    retries: 0,
    retryDelayMs: 0,
  });

  assert.deepEqual(result, {
    backendReachable: true,
    authProviders: [],
  });
});

test("get: attaches Bearer token from metadata store", async (t) => {
  const mockFetch = t.mock.fn(async () => makeMockResponse('{"providers":[]}'));
  global.fetch = mockFetch;
  const client = new HttpClient({ metadataStore: makeStore() });
  await client.get("/api/auth/providers");
  const init = mockFetch.mock.calls[0].arguments[1];
  assert.equal(init.headers["Authorization"], "Bearer test-token");
});

test("get: throws an error with the HTTP status when the request is unauthorized", async (t) => {
  const mockFetch = t.mock.fn(async () => makeMockResponse('{"message":"Unauthorized"}', 401));
  global.fetch = mockFetch;
  const client = new HttpClient({ metadataStore: makeStore() });

  await assert.rejects(
    () => client.get("/api/calendar/status"),
    (error) =>
      error instanceof Error &&
      error.message === "GET /api/calendar/status failed: 401" &&
      error.status === 401,
  );
});

test("fetchCalendarEvents: preserves the events wrapper returned by the backend", async (t) => {
  const mockFetch = t.mock.fn(async () =>
    makeMockResponse(
      '{"events":[{"id":"evt-1","calendarId":"primary","source":"google","title":"Planning","startTime":"2026-04-08T14:00:00.000Z","endTime":"2026-04-08T15:00:00.000Z","allDay":false,"color":"#7c5cdc","readOnly":false}]}',
    ),
  );
  global.fetch = mockFetch;
  const client = new HttpClient({ metadataStore: makeStore() });

  const result = await client.fetchCalendarEvents({
    timeMin: "2026-04-01T00:00:00.000Z",
    timeMax: "2026-04-30T23:59:59.999Z",
  });

  assert.ok(Array.isArray(result.events));
  assert.equal(result.events[0].id, "evt-1");
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
