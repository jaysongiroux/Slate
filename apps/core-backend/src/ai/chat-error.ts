/**
 * Turns a provider/transport failure from a chat turn into something a user can
 * act on. The raw text LangChain throws ("429 You have no credits remaining...
 * Troubleshooting URL: https://js.langchain.com/...") is developer noise, so we
 * classify it and keep the original only as expandable detail.
 */

export type ChatErrorCode =
  | "provider_no_credits"
  | "provider_rate_limited"
  | "provider_auth"
  | "provider_model_unavailable"
  | "provider_context_length"
  | "provider_unavailable"
  | "unknown";

export interface ChatErrorInfo {
  code: ChatErrorCode;
  /** Short headline for the error notice. */
  title: string;
  /** Plain-language explanation plus the next step the user can take. */
  message: string;
  /** Raw provider text, truncated — shown behind "Technical details". */
  detail?: string;
  /** Where the fix lives, when it is a page we can open. */
  actionUrl?: string;
  /** Whether retrying the same turn could plausibly succeed. */
  retryable: boolean;
}

const DETAIL_MAX_CHARS = 2000;

/** Hosted providers where running out of money is a thing that can happen. */
const BILLING_URLS: Record<string, string> = {
  OPENAI: "https://platform.openai.com/settings/organization/billing",
  ANTHROPIC: "https://console.anthropic.com/settings/billing",
};

const PROVIDER_LABELS: Record<string, string> = {
  OPENAI: "OpenAI",
  ANTHROPIC: "Anthropic",
  OLLAMA: "Ollama",
  OPENAI_COMPATIBLE: "the configured provider",
};

function providerLabel(provider?: string): string {
  return (provider && PROVIDER_LABELS[provider]) || "the model provider";
}

function rawText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function statusOf(error: unknown, text: string): number | undefined {
  const candidate = error as { status?: unknown; statusCode?: unknown } | null;
  const direct = candidate?.status ?? candidate?.statusCode;
  if (typeof direct === "number") {
    return direct;
  }
  const leading = /^\s*(\d{3})\b/.exec(text);
  return leading ? Number(leading[1]) : undefined;
}

function truncateDetail(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > DETAIL_MAX_CHARS ? `${trimmed.slice(0, DETAIL_MAX_CHARS - 1)}…` : trimmed;
}

export function classifyChatError(
  error: unknown,
  provider?: string,
  endpoint?: string | null,
): ChatErrorInfo {
  const text = rawText(error);
  const detail = truncateDetail(text);
  const status = statusOf(error, text);
  const label = providerLabel(provider);
  const billingUrl = provider ? BILLING_URLS[provider] : undefined;
  const info = (partial: Omit<ChatErrorInfo, "detail">): ChatErrorInfo => ({ ...partial, detail });

  if (/not configured|unsupported chat provider/i.test(text)) {
    return info({
      code: "provider_model_unavailable",
      title: "No chat model selected",
      message: "Choose a chat provider and model in Settings, then send your message again.",
      retryable: false,
    });
  }

  if (
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|fetch failed|socket hang up/i.test(text)
  ) {
    return info({
      code: "provider_unavailable",
      title: "Provider unreachable",
      message: endpoint
        ? `Slate could not reach ${label} at ${endpoint}. Make sure it is running, then retry.`
        : `Slate could not reach ${label}. Check your connection, then retry.`,
      retryable: true,
    });
  }

  if (
    billingUrl &&
    /no credits remaining|insufficient_quota|credit balance is too low|exceeded your current quota|billing/i.test(
      text,
    )
  ) {
    return info({
      code: "provider_no_credits",
      title: "Out of API credits",
      message: `Your ${label} account has no credits left, so the model refused the request. Add credits and retry.`,
      actionUrl: billingUrl,
      retryable: false,
    });
  }

  if (
    status === 401 ||
    status === 403 ||
    /incorrect api key|invalid api key|invalid_api_key|authentication/i.test(text)
  ) {
    return info({
      code: "provider_auth",
      title: "API key rejected",
      message: `${label} rejected the API key. Update it in Settings, then retry.`,
      retryable: false,
    });
  }

  if (status === 429) {
    return info({
      code: "provider_rate_limited",
      title: "Rate limited",
      message: `${label} is rate limiting this account. Wait a moment, then retry.`,
      retryable: true,
    });
  }

  if (
    /maximum context length|context_length_exceeded|too many tokens|prompt is too long/i.test(text)
  ) {
    return info({
      code: "provider_context_length",
      title: "Conversation too long",
      message:
        "This conversation no longer fits in the model's context window. Start a new conversation or ask a narrower question.",
      retryable: false,
    });
  }

  if (status === 404 || /does not exist|model not found|unknown model/i.test(text)) {
    return info({
      code: "provider_model_unavailable",
      title: "Model unavailable",
      message: `${label} does not have that model available for this account. Pick another model in Settings.`,
      retryable: false,
    });
  }

  if (status !== undefined && status >= 500) {
    return info({
      code: "provider_unavailable",
      title: "Provider unavailable",
      message: `${label} returned a server error. Wait a moment, then retry.`,
      retryable: true,
    });
  }

  return info({
    code: "unknown",
    title: "Something went wrong",
    message: `The request to ${label} failed before a reply came back. Retry, or check the details below.`,
    retryable: true,
  });
}
