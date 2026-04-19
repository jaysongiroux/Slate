export interface FormattedHomeAssistantError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class HomeAssistantUpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly upstreamMessage: string,
  ) {
    super(upstreamMessage);
    this.name = "HomeAssistantUpstreamError";
  }
}

function getStatus(err: unknown): number {
  if (err instanceof HomeAssistantUpstreamError) {
    return err.status;
  }

  if (typeof err === "object" && err !== null) {
    const candidate = err as { status?: unknown; statusCode?: unknown };
    if (typeof candidate.status === "number") {
      return candidate.status;
    }
    if (typeof candidate.statusCode === "number") {
      return candidate.statusCode;
    }
  }

  return 0;
}

function getMessage(err: unknown): string {
  if (err instanceof Error && typeof err.message === "string") {
    return err.message;
  }

  if (typeof err === "object" && err !== null) {
    const candidate = err as { message?: unknown };
    if (typeof candidate.message === "string") {
      return candidate.message;
    }
  }

  return typeof err === "string" ? err : "";
}

function isNetworkFailure(message: string): boolean {
  return /fetch failed|failed to fetch|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|socket hang up/i.test(
    message,
  );
}

export function formatHomeAssistantError(err: unknown): FormattedHomeAssistantError {
  const status = getStatus(err);
  const message = getMessage(err);

  if (status === 401 || status === 403) {
    return {
      code: "home_assistant_auth_failed",
      message:
        "Home Assistant rejected this token. Check the long-lived access token and try again.",
    };
  }

  if (status === 404) {
    return {
      code: "home_assistant_not_found",
      message: "This Home Assistant resource was not found.",
    };
  }

  if (isNetworkFailure(message)) {
    return {
      code: "home_assistant_unreachable",
      message: "Could not reach this Home Assistant instance. Check the URL and network.",
    };
  }

  if (message === "unsupported_control") {
    return {
      code: "home_assistant_unsupported_control",
      message: "Slate does not support controls for this entity yet.",
    };
  }

  if (message === "invalid_entity_id") {
    return {
      code: "home_assistant_invalid_entity",
      message: "That entity id is not valid.",
    };
  }

  if (message === "invalid_history_range") {
    return {
      code: "home_assistant_invalid_history_range",
      message: "History start and end must be valid ISO times with start before end.",
    };
  }

  if (message === "websocket_unavailable") {
    return {
      code: "home_assistant_websocket_unavailable",
      message: "Live updates are unavailable. Showing the latest refreshable state.",
    };
  }

  return {
    code: "home_assistant_service_failed",
    message: "Home Assistant could not run that action.",
  };
}
