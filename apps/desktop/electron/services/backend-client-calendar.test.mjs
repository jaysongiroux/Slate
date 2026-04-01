import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

import { BackendClient } from "./backend-client.mjs";

const require = createRequire(import.meta.url);
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

function makeClient() {
  const calls = [];
  const client = Object.create(BackendClient.prototype);
  client.calendarClient = () => ({ kind: "calendar-client" });
  client.currentAuthMetadata = () => ({ authorization: "Bearer token" });
  client.unary = async (service, method, payload, metadata) => {
    calls.push({ service, method, payload, metadata });
    return { ok: true, method };
  };
  return { client, calls };
}

test("desktop bundled proto exposes CalendarService", async () => {
  const protoPath = path.resolve(process.cwd(), "electron/proto/slate.proto");
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(packageDefinition).slate.v1;

  assert.equal(typeof proto.CalendarService, "function");
});

test("calendar RPC helpers call the expected service methods", async () => {
  const { client, calls } = makeClient();

  const payloads = [
    ["getCalendarStatus", "GetCalendarStatus", undefined],
    ["startCalendarOAuth", "StartCalendarOAuth", { providerId: "google" }],
    ["disconnectCalendar", "DisconnectCalendar", { connectionId: "conn-1" }],
    ["listCalendars", "ListGoogleCalendars", { connectionId: "conn-1" }],
    [
      "subscribeCalendar",
      "SubscribeCalendar",
      { connectionId: "conn-1", calendarId: "primary", name: "Primary" },
    ],
    ["unsubscribeCalendar", "UnsubscribeCalendar", { subscriptionId: "sub-1" }],
    [
      "updateCalendarSubscription",
      "UpdateCalendarSubscription",
      { subscriptionId: "sub-1", enabled: true },
    ],
    [
      "addIcsSubscription",
      "AddIcsSubscription",
      { url: "https://example.com/feed.ics", name: "Feed" },
    ],
    ["removeIcsSubscription", "RemoveIcsSubscription", { id: "ics-1" }],
    ["updateIcsSubscription", "UpdateIcsSubscription", { id: "ics-1", enabled: false }],
    [
      "fetchCalendarEvents",
      "FetchCalendarEvents",
      { timeMin: "2026-03-01T00:00:00.000Z", timeMax: "2026-03-31T23:59:59.999Z" },
    ],
    ["createCalendarEvent", "CreateCalendarEvent", { subscriptionId: "sub-1", title: "Planning" }],
    [
      "updateCalendarEvent",
      "UpdateCalendarEvent",
      { subscriptionId: "sub-1", eventId: "evt-1", title: "Updated" },
    ],
    ["deleteCalendarEvent", "DeleteCalendarEvent", { subscriptionId: "sub-1", eventId: "evt-1" }],
  ];

  for (const [methodName, expectedRpc, payload] of payloads) {
    const result =
      payload === undefined ? await client[methodName]() : await client[methodName](payload);
    assert.deepEqual(result, { ok: true, method: expectedRpc });
  }

  assert.equal(calls.length, payloads.length);

  for (let index = 0; index < payloads.length; index += 1) {
    const [methodName, expectedRpc, payload] = payloads[index];
    const call = calls[index];
    assert.equal(
      call.service.kind,
      "calendar-client",
      `${methodName} should use the calendar gRPC client`,
    );
    assert.equal(call.method, expectedRpc, `${methodName} should target ${expectedRpc}`);
    assert.deepEqual(call.payload, payload ?? {}, `${methodName} should forward its payload`);
    assert.deepEqual(
      call.metadata,
      { authorization: "Bearer token" },
      `${methodName} should include auth metadata`,
    );
  }
});
