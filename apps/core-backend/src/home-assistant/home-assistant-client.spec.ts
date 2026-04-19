import {
  HomeAssistantWebSocketAdapter,
  homeAssistantRestGet,
  homeAssistantRestPost,
  normalizeHomeAssistantUrl,
  sendHomeAssistantWebSocketCommand,
  subscribeHomeAssistantStateChanges,
  validateHomeAssistantInstance,
} from "./home-assistant-client";
import { formatHomeAssistantError, HomeAssistantUpstreamError } from "./home-assistant.errors";

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; statusText?: string } = {},
) {
  const text = JSON.stringify(body);

  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    text: jest.fn().mockResolvedValue(text),
    json: jest.fn().mockResolvedValue(body),
  };
}

describe("Home Assistant REST client helpers", () => {
  it("normalizes base URLs by trimming whitespace and removing trailing slashes", () => {
    expect(normalizeHomeAssistantUrl("  http://homeassistant.local:8123///  ")).toBe(
      "http://homeassistant.local:8123",
    );
  });

  it("sends authorization headers and returns JSON from GET requests", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ state: "on" }));

    const result = await homeAssistantRestGet(
      " http://homeassistant.local:8123/ ",
      "token-123",
      "api/states/light.lamp",
      fetchImpl,
    );

    expect(result).toEqual({ state: "on" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://homeassistant.local:8123/api/states/light.lamp",
      {
        headers: {
          Authorization: "Bearer token-123",
        },
      },
    );
  });

  it("throws HomeAssistantUpstreamError for non-OK REST responses", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: jest.fn().mockResolvedValue("warming up"),
    });

    await expect(
      homeAssistantRestGet(
        "http://homeassistant.local:8123",
        "token-123",
        "/api/states",
        fetchImpl,
      ),
    ).rejects.toEqual(new HomeAssistantUpstreamError(503, "warming up"));
  });

  it("POSTs JSON with method, content type, auth header, and body", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const body = { entity_id: "light.lamp" };

    const result = await homeAssistantRestPost(
      "http://homeassistant.local:8123/",
      "token-123",
      "/api/services/light/toggle",
      body,
      fetchImpl,
    );

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://homeassistant.local:8123/api/services/light/toggle",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-123",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  });

  it("returns null for empty REST responses", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: "No Content",
      text: jest.fn().mockResolvedValue(""),
    });

    await expect(
      homeAssistantRestGet(
        "http://homeassistant.local:8123",
        "token-123",
        "/api/states",
        fetchImpl,
      ),
    ).resolves.toBeNull();
  });

  it("throws HomeAssistantUpstreamError for malformed successful JSON responses", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: jest.fn().mockResolvedValue("{oops"),
    });

    await expect(
      homeAssistantRestGet(
        "http://homeassistant.local:8123",
        "token-123",
        "/api/states",
        fetchImpl,
      ),
    ).rejects.toEqual(new HomeAssistantUpstreamError(502, "Invalid Home Assistant response"));
  });

  it("validates an instance by calling the API root", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ message: "API running." }));

    await expect(
      validateHomeAssistantInstance("http://homeassistant.local:8123/", "token-123", fetchImpl),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledWith("http://homeassistant.local:8123/api/", {
      headers: {
        Authorization: "Bearer token-123",
      },
    });
  });
});

class MockHomeAssistantSocket implements HomeAssistantWebSocketAdapter {
  public readonly sent: string[] = [];
  public closed = false;
  private messageHandler: ((data: string) => void) | undefined;
  private errorHandler: ((error: unknown) => void) | undefined;
  private closeHandler: (() => void) | undefined;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.closeHandler?.();
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onError(handler: (error: unknown) => void): void {
    this.errorHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  emitMessage(message: Record<string, unknown>): void {
    this.messageHandler?.(JSON.stringify(message));
  }

  emitError(error: unknown): void {
    this.errorHandler?.(error);
  }
}

describe("Home Assistant WebSocket client helpers", () => {
  function createMockFactory() {
    const sockets: MockHomeAssistantSocket[] = [];
    const urls: string[] = [];
    const createSocket = jest.fn((url: string) => {
      urls.push(url);
      const socket = new MockHomeAssistantSocket();
      sockets.push(socket);
      return socket;
    });

    return { createSocket, sockets, urls };
  }

  it("sends command ids starting at 1", async () => {
    const { createSocket, sockets } = createMockFactory();

    const promise = sendHomeAssistantWebSocketCommand(
      "http://homeassistant.local:8123",
      "token-123",
      { type: "first" },
      createSocket,
    );
    sockets[0].emitMessage({ type: "auth_required" });
    sockets[0].emitMessage({ type: "auth_ok" });

    expect(JSON.parse(sockets[0].sent[1])).toEqual({ id: 1, type: "first" });

    sockets[0].emitMessage({ id: 1, type: "result", success: true, result: "first-ok" });
    await expect(promise).resolves.toBe("first-ok");
  });

  it("sends auth after auth_required and uses the Home Assistant WebSocket URL", async () => {
    const { createSocket, sockets, urls } = createMockFactory();

    const promise = sendHomeAssistantWebSocketCommand(
      " https://homeassistant.local:8123/ ",
      "token-123",
      { type: "ping" },
      createSocket,
    );

    sockets[0].emitMessage({ type: "auth_required" });
    expect(JSON.parse(sockets[0].sent[0])).toEqual({
      type: "auth",
      access_token: "token-123",
    });

    sockets[0].emitMessage({ type: "auth_ok" });
    const command = JSON.parse(sockets[0].sent[1]);
    sockets[0].emitMessage({
      id: command.id,
      type: "result",
      success: true,
      result: { pong: true },
    });

    await expect(promise).resolves.toEqual({ pong: true });
    expect(urls).toEqual(["wss://homeassistant.local:8123/api/websocket"]);
  });

  it("resolves only the result matching the command id", async () => {
    const { createSocket, sockets } = createMockFactory();

    const promise = sendHomeAssistantWebSocketCommand(
      "http://homeassistant.local:8123",
      "token-123",
      { type: "config/entity_registry/list" },
      createSocket,
    );

    sockets[0].emitMessage({ type: "auth_required" });
    sockets[0].emitMessage({ type: "auth_ok" });
    const command = JSON.parse(sockets[0].sent[1]);
    sockets[0].emitMessage({ id: command.id + 1, type: "result", success: true, result: "wrong" });
    sockets[0].emitMessage({ id: command.id, type: "result", success: true, result: ["right"] });

    await expect(promise).resolves.toEqual(["right"]);
    expect(sockets[0].closed).toBe(true);
  });

  it("rejects auth failures with an auth-shaped upstream error", async () => {
    const { createSocket, sockets } = createMockFactory();

    const promise = sendHomeAssistantWebSocketCommand(
      "http://homeassistant.local:8123",
      "super-secret-token",
      { type: "ping" },
      createSocket,
    );

    sockets[0].emitMessage({ type: "auth_required" });
    sockets[0].emitMessage({ type: "auth_invalid", message: "Invalid access token" });

    await expect(promise).rejects.toEqual(
      new HomeAssistantUpstreamError(401, "Home Assistant authentication failed"),
    );
    await expect(promise).rejects.not.toThrow("super-secret-token");
    expect(sockets[0].closed).toBe(true);
  });

  it("rejects command failures with HomeAssistantUpstreamError without leaking secrets", async () => {
    const { createSocket, sockets } = createMockFactory();

    const promise = sendHomeAssistantWebSocketCommand(
      "http://homeassistant.local:8123",
      "super-secret-token",
      { type: "call_service", token: "super-secret-token" },
      createSocket,
    );

    sockets[0].emitMessage({ type: "auth_required" });
    sockets[0].emitMessage({ type: "auth_ok" });
    const command = JSON.parse(sockets[0].sent[1]);
    sockets[0].emitMessage({
      id: command.id,
      type: "result",
      success: false,
      error: { code: "invalid_format", message: "bad super-secret-token" },
    });

    await expect(promise).rejects.toEqual(new HomeAssistantUpstreamError(400, "invalid_format"));
    await expect(promise).rejects.not.toThrow("super-secret-token");
    expect(sockets[0].closed).toBe(true);
  });

  it("times out when no matching result arrives and formats as websocket unavailable", async () => {
    jest.useFakeTimers();
    try {
      const { createSocket, sockets } = createMockFactory();

      const promise = sendHomeAssistantWebSocketCommand(
        "http://homeassistant.local:8123",
        "token-123",
        { type: "ping" },
        createSocket,
        { timeoutMs: 50 },
      );

      sockets[0].emitMessage({ type: "auth_required" });
      sockets[0].emitMessage({ type: "auth_ok" });
      sockets[0].emitMessage({ id: 999, type: "result", success: true, result: "wrong" });

      jest.advanceTimersByTime(50);
      await expect(promise).rejects.toThrow("websocket_unavailable");
      await expect(promise.catch((err) => formatHomeAssistantError(err))).resolves.toEqual({
        code: "home_assistant_websocket_unavailable",
        message: "Live updates are unavailable. Showing the latest refreshable state.",
      });
      expect(sockets[0].closed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps a state_changed subscription open and emits new states", async () => {
    const { createSocket, sockets } = createMockFactory();
    const states: unknown[] = [];
    const statuses: string[] = [];

    const promise = subscribeHomeAssistantStateChanges(
      "http://homeassistant.local:8123",
      "token-123",
      {
        onState: (state) => states.push(state),
        onStatus: (status) => statuses.push(status),
      },
      createSocket,
    );

    sockets[0].emitMessage({ type: "auth_required" });
    sockets[0].emitMessage({ type: "auth_ok" });
    const command = JSON.parse(sockets[0].sent[1]);
    expect(command).toEqual({ id: 1, type: "subscribe_events", event_type: "state_changed" });

    sockets[0].emitMessage({ id: command.id, type: "result", success: true, result: null });
    const unsubscribe = await promise;
    expect(statuses).toContain("subscribed");
    expect(sockets[0].closed).toBe(false);

    sockets[0].emitMessage({
      id: command.id,
      type: "event",
      event: {
        event_type: "state_changed",
        data: {
          entity_id: "light.lamp",
          new_state: { entity_id: "light.lamp", state: "on", attributes: {} },
        },
      },
    });

    expect(states).toEqual([{ entity_id: "light.lamp", state: "on", attributes: {} }]);
    unsubscribe();
    expect(sockets[0].closed).toBe(true);
  });
});
