import { classifyChatError } from "./chat-error";

/** The literal error LangChain surfaced when the OpenAI account ran out of credits. */
const OPENAI_NO_CREDITS =
  "429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.\n\nTroubleshooting URL: https://js.langchain.com/docs/troubleshooting/errors/MODEL_RATE_LIMIT/\n";

describe("classifyChatError", () => {
  it("classifies an OpenAI out-of-credits 429 as provider_no_credits with a billing link", () => {
    const result = classifyChatError(new Error(OPENAI_NO_CREDITS), "OPENAI");

    expect(result.code).toBe("provider_no_credits");
    expect(result.retryable).toBe(false);
    expect(result.actionUrl).toBe("https://platform.openai.com/settings/organization/billing");
    expect(result.title).toBe("Out of API credits");
    expect(result.message).toContain("OpenAI");
    expect(result.message).not.toContain("Troubleshooting URL");
  });

  it("keeps the raw provider text as detail", () => {
    const result = classifyChatError(new Error(OPENAI_NO_CREDITS), "OPENAI");

    expect(result.detail).toContain("You have no credits remaining");
  });

  it("truncates very long detail text", () => {
    const result = classifyChatError(new Error("429 rate limit " + "x".repeat(5000)), "OPENAI");

    expect(result.detail!.length).toBeLessThanOrEqual(2000);
  });

  it("classifies an Anthropic credit-balance error as provider_no_credits with a console link", () => {
    const result = classifyChatError(
      new Error("400 Your credit balance is too low to access the Anthropic API"),
      "ANTHROPIC",
    );

    expect(result.code).toBe("provider_no_credits");
    expect(result.actionUrl).toBe("https://console.anthropic.com/settings/billing");
    expect(result.message).toContain("Anthropic");
  });

  it("classifies a plain 429 as provider_rate_limited and retryable", () => {
    const result = classifyChatError(
      new Error("429 Rate limit reached for gpt-4o. Please try again in 20s."),
      "OPENAI",
    );

    expect(result.code).toBe("provider_rate_limited");
    expect(result.retryable).toBe(true);
    expect(result.actionUrl).toBeUndefined();
  });

  it("classifies an invalid API key as provider_auth", () => {
    const result = classifyChatError(
      new Error("401 Incorrect API key provided: sk-abc123. You can find your API key at ..."),
      "OPENAI",
    );

    expect(result.code).toBe("provider_auth");
    expect(result.retryable).toBe(false);
    expect(result.title).toBe("API key rejected");
  });

  it("classifies a 403 as provider_auth", () => {
    const result = classifyChatError(new Error("403 Forbidden"), "OPENAI");

    expect(result.code).toBe("provider_auth");
  });

  it("classifies an unknown model as provider_model_unavailable", () => {
    const result = classifyChatError(
      new Error("404 The model `gpt-5-turbo` does not exist or you do not have access to it."),
      "OPENAI",
    );

    expect(result.code).toBe("provider_model_unavailable");
    expect(result.retryable).toBe(false);
  });

  it("classifies an over-long prompt as provider_context_length", () => {
    const result = classifyChatError(
      new Error(
        "400 This model's maximum context length is 128000 tokens, however you requested 190210 tokens.",
      ),
      "OPENAI",
    );

    expect(result.code).toBe("provider_context_length");
    expect(result.retryable).toBe(false);
    expect(result.message).toContain("conversation");
  });

  it("classifies a 500 from the provider as provider_unavailable and retryable", () => {
    const result = classifyChatError(new Error("500 Internal server error"), "OPENAI");

    expect(result.code).toBe("provider_unavailable");
    expect(result.retryable).toBe(true);
  });

  it("classifies a refused connection to Ollama as provider_unavailable naming the endpoint", () => {
    const result = classifyChatError(
      new Error("connect ECONNREFUSED 127.0.0.1:11434"),
      "OLLAMA",
      "http://localhost:11434",
    );

    expect(result.code).toBe("provider_unavailable");
    expect(result.retryable).toBe(true);
    expect(result.message).toContain("http://localhost:11434");
    expect(result.message).not.toContain("credits");
  });

  it("never blames credits for a local provider", () => {
    const result = classifyChatError(new Error(OPENAI_NO_CREDITS), "OLLAMA");

    expect(result.actionUrl).toBeUndefined();
  });

  it("classifies a missing chat model configuration as provider_model_unavailable", () => {
    const result = classifyChatError(new Error("Chat model not configured"), undefined);

    expect(result.code).toBe("provider_model_unavailable");
    expect(result.message).toContain("Settings");
  });

  it("falls back to unknown with a usable message for unrecognised errors", () => {
    const result = classifyChatError(new Error("something exploded"), "OPENAI");

    expect(result.code).toBe("unknown");
    expect(result.retryable).toBe(true);
    expect(result.title).toBe("Something went wrong");
    expect(result.detail).toContain("something exploded");
  });

  it("handles non-Error throwables", () => {
    const result = classifyChatError("just a string", "OPENAI");

    expect(result.code).toBe("unknown");
    expect(result.detail).toContain("just a string");
  });

  it("reads the status off an error object when the message omits it", () => {
    const err = Object.assign(new Error("insufficient_quota"), { status: 429 });

    const result = classifyChatError(err, "OPENAI");

    expect(result.code).toBe("provider_no_credits");
  });
});
