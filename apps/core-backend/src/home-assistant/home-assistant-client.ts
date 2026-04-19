import { HomeAssistantUpstreamError } from "./home-assistant.errors";

interface HomeAssistantFetchResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  body?: ReadableStream<Uint8Array> | null;
  headers?: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
}

type HomeAssistantFetch = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<HomeAssistantFetchResponse>;

export interface HomeAssistantWebSocketAdapter {
  send(data: string): void;
  close(): void;
  onMessage(handler: (data: string) => void): void;
  onError(handler: (error: unknown) => void): void;
  onClose(handler: () => void): void;
}

export type HomeAssistantWebSocketFactory = (url: string) => HomeAssistantWebSocketAdapter;

export interface SendHomeAssistantWebSocketCommandOptions {
  timeoutMs?: number;
}

export interface HomeAssistantStateChangeHandlers {
  onState(state: unknown): void;
  onStatus?(status: "connecting" | "authenticated" | "subscribed" | "closed"): void;
  onError?(error: unknown): void;
}

export function normalizeHomeAssistantUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function buildHomeAssistantUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = normalizeHomeAssistantUrl(baseUrl);
  const normalizedPath = path.replace(/^\/+/, "");

  return `${normalizedBaseUrl}/${normalizedPath}`;
}

async function readRestResponse(response: HomeAssistantFetchResponse): Promise<unknown> {
  if (!response.ok) {
    let text = "";
    try {
      text = await response.text();
    } catch {
      text = "";
    }

    throw new HomeAssistantUpstreamError(
      response.status,
      text || response.statusText || "Home Assistant request failed",
    );
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new HomeAssistantUpstreamError(502, "Invalid Home Assistant response");
  }
}

export async function homeAssistantRestGet(
  baseUrl: string,
  token: string,
  path: string,
  fetchImpl: HomeAssistantFetch = fetch,
): Promise<unknown> {
  const response = await fetchImpl(buildHomeAssistantUrl(baseUrl, path), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return readRestResponse(response);
}

export async function homeAssistantRestRawGet(
  baseUrl: string,
  token: string,
  path: string,
  fetchImpl: HomeAssistantFetch = fetch,
): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string; status: number }> {
  const response = await fetchImpl(buildHomeAssistantUrl(baseUrl, path), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return {
    body: response.body ?? null,
    contentType: response.headers?.get("content-type") ?? "application/octet-stream",
    status: response.status,
  };
}

export async function homeAssistantRestPost(
  baseUrl: string,
  token: string,
  path: string,
  body: unknown,
  fetchImpl: HomeAssistantFetch = fetch,
): Promise<unknown> {
  const response = await fetchImpl(buildHomeAssistantUrl(baseUrl, path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return readRestResponse(response);
}

export async function validateHomeAssistantInstance(
  baseUrl: string,
  token: string,
  fetchImpl: HomeAssistantFetch = fetch,
): Promise<void> {
  await homeAssistantRestGet(baseUrl, token, "/api/", fetchImpl);
}

function buildHomeAssistantWebSocketUrl(baseUrl: string): string {
  const url = new URL(normalizeHomeAssistantUrl(baseUrl));

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }

  url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/websocket`;
  url.search = "";
  url.hash = "";

  return url.toString();
}

function getWebSocketErrorMessage(message: unknown, token: string): string {
  if (typeof message !== "object" || message === null) {
    return "Home Assistant WebSocket command failed";
  }

  const error = (message as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return "Home Assistant WebSocket command failed";
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.length > 0) {
    return code;
  }

  const upstreamMessage = (error as { message?: unknown }).message;
  if (typeof upstreamMessage === "string" && upstreamMessage.length > 0) {
    if (!token) {
      return upstreamMessage;
    }

    return upstreamMessage.replaceAll(token, "[redacted]");
  }

  return "Home Assistant WebSocket command failed";
}

export async function sendHomeAssistantWebSocketCommand(
  baseUrl: string,
  token: string,
  command: Record<string, unknown>,
  createSocket: HomeAssistantWebSocketFactory,
  options: SendHomeAssistantWebSocketCommandOptions = {},
): Promise<unknown> {
  const socket = createSocket(buildHomeAssistantWebSocketUrl(baseUrl));
  const commandId = 1;
  const timeoutMs = options.timeoutMs ?? 10_000;
  let settled = false;
  let commandSent = false;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      finishReject(new Error("websocket_unavailable"));
    }, timeoutMs);

    const closeSocket = () => {
      socket.close();
    };

    const finishResolve = (value: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(value);
      closeSocket();
    };

    const finishReject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
      closeSocket();
    };

    socket.onMessage((rawData) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        finishReject(new Error("Home Assistant WebSocket sent invalid JSON"));
        return;
      }

      if (message.type === "auth_required") {
        socket.send(
          JSON.stringify({
            type: "auth",
            access_token: token,
          }),
        );
        return;
      }

      if (message.type === "auth_invalid") {
        finishReject(new HomeAssistantUpstreamError(401, "Home Assistant authentication failed"));
        return;
      }

      if (message.type === "auth_ok" && !commandSent) {
        commandSent = true;
        socket.send(
          JSON.stringify({
            id: commandId,
            ...command,
          }),
        );
        return;
      }

      if (message.type !== "result" || message.id !== commandId) {
        return;
      }

      if (message.success === false) {
        finishReject(new HomeAssistantUpstreamError(400, getWebSocketErrorMessage(message, token)));
        return;
      }

      finishResolve(message.result ?? null);
    });

    socket.onError((error) => {
      finishReject(error instanceof Error ? error : new Error("Home Assistant WebSocket failed"));
    });

    socket.onClose(() => {
      if (!settled) {
        finishReject(new Error("websocket_unavailable"));
      }
    });
  });
}

export async function subscribeHomeAssistantStateChanges(
  baseUrl: string,
  token: string,
  handlers: HomeAssistantStateChangeHandlers,
  createSocket: HomeAssistantWebSocketFactory,
  options: SendHomeAssistantWebSocketCommandOptions = {},
): Promise<() => void> {
  const socket = createSocket(buildHomeAssistantWebSocketUrl(baseUrl));
  const commandId = 1;
  const timeoutMs = options.timeoutMs ?? 10_000;
  let settled = false;
  let closed = false;
  let commandSent = false;
  let subscribed = false;

  handlers.onStatus?.("connecting");

  return new Promise((resolve, reject) => {
    const closeSocket = () => {
      if (closed) {
        return;
      }
      closed = true;
      socket.close();
    };

    const timeout = setTimeout(() => {
      finishReject(new Error("websocket_unavailable"));
    }, timeoutMs);

    const unsubscribe = () => {
      clearTimeout(timeout);
      closeSocket();
    };

    const finishResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      subscribed = true;
      clearTimeout(timeout);
      handlers.onStatus?.("subscribed");
      resolve(unsubscribe);
    };

    const finishReject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
      closeSocket();
    };

    socket.onMessage((data) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(data) as Record<string, unknown>;
      } catch {
        finishReject(new Error("Home Assistant WebSocket sent invalid JSON"));
        return;
      }

      if (message.type === "auth_required") {
        socket.send(
          JSON.stringify({
            type: "auth",
            access_token: token,
          }),
        );
        return;
      }

      if (message.type === "auth_invalid") {
        finishReject(new HomeAssistantUpstreamError(401, "Home Assistant authentication failed"));
        return;
      }

      if (message.type === "auth_ok" && !commandSent) {
        commandSent = true;
        handlers.onStatus?.("authenticated");
        socket.send(
          JSON.stringify({
            id: commandId,
            type: "subscribe_events",
            event_type: "state_changed",
          }),
        );
        return;
      }

      if (message.type === "result" && message.id === commandId) {
        if (message.success === false) {
          finishReject(
            new HomeAssistantUpstreamError(400, getWebSocketErrorMessage(message, token)),
          );
          return;
        }

        finishResolve();
        return;
      }

      if (message.type !== "event" || message.id !== commandId) {
        return;
      }

      const event = asWebSocketRecord(message.event);
      if (event.event_type !== "state_changed") {
        return;
      }

      const eventData = asWebSocketRecord(event.data);
      if (eventData.new_state) {
        handlers.onState(eventData.new_state);
      }
    });

    socket.onError((error) => {
      const normalizedError =
        error instanceof Error ? error : new Error("Home Assistant WebSocket failed");
      if (subscribed) {
        handlers.onError?.(normalizedError);
        return;
      }
      finishReject(normalizedError);
    });

    socket.onClose(() => {
      handlers.onStatus?.("closed");
      if (!settled) {
        finishReject(new Error("websocket_unavailable"));
      }
    });
  });
}

function asWebSocketRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
