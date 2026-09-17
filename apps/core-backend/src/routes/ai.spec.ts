import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import aiRoutes from "./ai";
import type { StreamEvent } from "../ai/agent.service";

type Overrides = {
  config?: unknown;
  configError?: Error;
  events?: StreamEvent[];
};

function parseSse(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)));
}

async function buildApp(overrides: Overrides = {}) {
  const {
    config = { chatProvider: "OPENAI", chatModel: "gpt-4o" },
    configError,
    events = [{ type: "done" }],
  } = overrides;

  const streamResponse = jest.fn((..._args: unknown[]) =>
    (async function* () {
      for (const event of events) {
        yield event;
      }
    })(),
  );

  const app: FastifyInstance = Fastify();
  app.decorate("authenticate", async (request: FastifyRequest) => {
    request.user = { userId: "user-1" } as never;
  });
  app.decorate("aiConfigService", {
    getConfig: jest.fn(async () => {
      if (configError) throw configError;
      return config;
    }),
  } as never);
  app.decorate("conversationService", {
    addMessage: jest.fn().mockResolvedValue({}),
  } as never);
  app.decorate("agentService", {
    streamResponse,
    abortActiveChatStream: jest.fn(),
  } as never);
  await app.register(aiRoutes);
  await app.ready();

  return { app, streamResponse };
}

async function send(app: FastifyInstance, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/ai/conversations/conv-1/messages",
    payload: { content: "Summarize my projects", ...payload },
  });
  return parseSse(response.body);
}

describe("POST /api/ai/conversations/:conversationId/messages", () => {
  it("forwards the retry flag to the agent", async () => {
    const { app, streamResponse } = await buildApp();

    await send(app, { retry: true });

    expect(streamResponse).toHaveBeenCalledWith(
      "user-1",
      "conv-1",
      "Summarize my projects",
      expect.any(Function),
      [],
      [],
      "",
      true,
    );
    await app.close();
  });

  it("treats a turn without the retry flag as a fresh turn", async () => {
    const { app, streamResponse } = await buildApp();

    await send(app, {});

    expect(streamResponse.mock.calls[0][7]).toBe(false);
    await app.close();
  });

  it("relays the agent's classified error event to the client", async () => {
    const { app } = await buildApp({
      events: [
        {
          type: "error",
          content: "Your OpenAI account has no credits left.",
          title: "Out of API credits",
          code: "provider_no_credits",
          retryable: false,
        },
      ],
    });

    const events = await send(app, {});

    expect(events).toEqual([
      {
        type: "error",
        content: "Your OpenAI account has no credits left.",
        title: "Out of API credits",
        code: "provider_no_credits",
        retryable: false,
      },
    ]);
    await app.close();
  });

  it("reports a missing chat model as a structured error the UI can render", async () => {
    const { app } = await buildApp({ config: { chatProvider: "OPENAI" } });

    const events = await send(app, {});

    expect(events).toEqual([
      expect.objectContaining({
        type: "error",
        code: "provider_model_unavailable",
        title: "No chat model selected",
        retryable: false,
      }),
    ]);
    await app.close();
  });

  it("classifies an unexpected failure before the stream starts", async () => {
    const { app } = await buildApp({
      configError: Object.assign(new Error("401 Incorrect API key provided"), { status: 401 }),
    });

    const events = await send(app, {});

    expect(events).toEqual([
      expect.objectContaining({
        type: "error",
        code: "provider_auth",
        title: "API key rejected",
        retryable: false,
      }),
    ]);
    await app.close();
  });
});
