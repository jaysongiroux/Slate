import { McpService } from "../mcp.service";
import { encryptSecret, decryptSecret } from "../../ai/encryption.util";
import { v4 as uuid } from "uuid";

const ENCRYPTION_KEY = "test-key-for-mcp-service-spec-only";

function makeMockPrisma(rowValue: unknown) {
  return {
    setting: {
      findFirst: jest.fn().mockResolvedValue(rowValue == null ? null : { value: rowValue }),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) =>
      fn({
        setting: {
          findFirst: jest.fn().mockResolvedValue(rowValue == null ? null : { value: rowValue }),
          upsert: jest.fn().mockResolvedValue({}),
        },
        $queryRaw: jest.fn(),
      }),
    ),
  } as any;
}

describe("McpService.getServers", () => {
  it("returns [] when the setting row is missing", async () => {
    const svc = new McpService(makeMockPrisma(null), ENCRYPTION_KEY);
    expect(await svc.getServers("u1")).toEqual([]);
  });

  it("returns sanitized servers (no secrets) for bearer auth", async () => {
    const stored = {
      version: 1,
      servers: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "linear",
          url: "https://mcp.linear.app/sse",
          transport: "sse",
          auth: { type: "bearer", tokenEncrypted: encryptSecret("secret-token", ENCRYPTION_KEY) },
          enabled: true,
          enabledTools: null,
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
      ],
    };
    const svc = new McpService(makeMockPrisma(stored), ENCRYPTION_KEY);
    const result = await svc.getServers("u1");
    expect(result).toHaveLength(1);
    expect(result[0].auth).toEqual({ type: "bearer", hasToken: true });
    expect(JSON.stringify(result[0])).not.toContain("secret-token");
    expect(JSON.stringify(result[0])).not.toContain("tokenEncrypted");
  });

  it("returns sanitized headers auth", async () => {
    const stored = {
      version: 1,
      servers: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "x",
          url: "https://x",
          transport: "http",
          auth: {
            type: "headers",
            headersEncrypted: [
              { name: "X-Token", valueEncrypted: encryptSecret("v1", ENCRYPTION_KEY) },
              { name: "X-User", valueEncrypted: encryptSecret("v2", ENCRYPTION_KEY) },
            ],
          },
          enabled: true,
          enabledTools: null,
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
      ],
    };
    const svc = new McpService(makeMockPrisma(stored), ENCRYPTION_KEY);
    const result = await svc.getServers("u1");
    expect(result[0].auth).toEqual({ type: "headers", headerNames: ["X-Token", "X-User"] });
  });
});

describe("McpService.getServersWithSecrets", () => {
  it("decrypts bearer token", async () => {
    const stored = {
      version: 1,
      servers: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "linear",
          url: "https://x",
          transport: "sse",
          auth: {
            type: "bearer",
            tokenEncrypted: encryptSecret("plaintext-token", ENCRYPTION_KEY),
          },
          enabled: true,
          enabledTools: null,
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
      ],
    };
    const svc = new McpService(makeMockPrisma(stored), ENCRYPTION_KEY);
    const [server] = await svc.getServersWithSecrets("u1");
    expect(server.auth).toEqual({ type: "bearer", token: "plaintext-token" });
  });
});

describe("McpService.saveServers", () => {
  it("rejects duplicate names", async () => {
    const prisma = makeMockPrisma(null);
    const svc = new McpService(prisma, ENCRYPTION_KEY);
    await expect(
      svc.saveServers("u1", [
        {
          name: "linear",
          url: "https://a",
          transport: "sse",
          auth: { type: "none" },
          enabled: true,
          enabledTools: null,
        },
        {
          name: "linear",
          url: "https://b",
          transport: "sse",
          auth: { type: "none" },
          enabled: true,
          enabledTools: null,
        },
      ]),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("encrypts bearer token before persisting and never returns plaintext", async () => {
    let upserted: any = null;
    const prisma = {
      $transaction: jest.fn(async (fn: any) =>
        fn({
          setting: {
            findFirst: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockImplementation(({ create }: any) => {
              upserted = create.value;
              return Promise.resolve({});
            }),
          },
          $queryRaw: jest.fn(),
        }),
      ),
    } as any;
    const svc = new McpService(prisma, ENCRYPTION_KEY);
    const result = await svc.saveServers("u1", [
      {
        name: "linear",
        url: "https://x",
        transport: "sse",
        auth: { type: "bearer", token: "secret-token" },
        enabled: true,
        enabledTools: null,
      },
    ]);
    expect(result[0].auth).toEqual({ type: "bearer", hasToken: true });
    expect(JSON.stringify(upserted)).toContain("tokenEncrypted");
    expect(JSON.stringify(upserted)).not.toContain("secret-token");
  });

  it("preserves an unchanged auth when editing", async () => {
    const existingId = uuid();
    const existing = {
      version: 1,
      servers: [
        {
          id: existingId,
          name: "linear",
          url: "https://x",
          transport: "sse",
          auth: { type: "bearer", tokenEncrypted: encryptSecret("existing-token", ENCRYPTION_KEY) },
          enabled: true,
          enabledTools: null,
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
      ],
    };
    let upserted: any = null;
    const prisma = {
      $transaction: jest.fn(async (fn: any) =>
        fn({
          setting: {
            findFirst: jest.fn().mockResolvedValue({ value: existing }),
            upsert: jest.fn().mockImplementation(({ create }: any) => {
              upserted = create.value;
              return Promise.resolve({});
            }),
          },
          $queryRaw: jest.fn(),
        }),
      ),
    } as any;
    const svc = new McpService(prisma, ENCRYPTION_KEY);
    await svc.saveServers("u1", [
      {
        id: existingId,
        name: "linear",
        url: "https://x",
        transport: "sse",
        auth: { type: "unchanged" },
        enabled: false,
        enabledTools: null,
      },
    ]);
    const savedAuth = upserted.servers[0].auth;
    expect(savedAuth.type).toBe("bearer");
    expect(savedAuth.tokenEncrypted).toBeTruthy();
    expect(decryptSecret(savedAuth.tokenEncrypted, ENCRYPTION_KEY)).toBe("existing-token");
  });

  it("rejects unknown id when auth is unchanged", async () => {
    const prisma = {
      $transaction: jest.fn(async (fn: any) =>
        fn({
          setting: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
          $queryRaw: jest.fn(),
        }),
      ),
    } as any;
    const svc = new McpService(prisma, ENCRYPTION_KEY);
    await expect(
      svc.saveServers("u1", [
        {
          id: uuid(),
          name: "linear",
          url: "https://x",
          transport: "sse",
          auth: { type: "unchanged" },
          enabled: true,
          enabledTools: null,
        },
      ]),
    ).rejects.toThrow(/unchanged.*unknown|cannot.*unchanged/i);
  });
});
