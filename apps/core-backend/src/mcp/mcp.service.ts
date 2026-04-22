import type { PrismaClient, Prisma } from "@prisma/client";
import { v4 as uuidV4 } from "uuid";
import { encryptSecret, decryptSecret } from "../ai/encryption.util";
import { MCP_SERVERS_SETTING_KEY } from "./mcp.constants";
import { McpServersSettingSchema, McpServerSaveInputArraySchema } from "./mcp.schema";
import type {
  McpServerStored,
  McpServerDecrypted,
  McpServerPublic,
  McpServerSaveInput,
} from "./mcp.types";

export class McpService {
  constructor(
    private prisma: PrismaClient,
    private encryptionKey: string,
  ) {}

  async getServers(userId: string): Promise<McpServerPublic[]> {
    const stored = await this.readStored(userId);
    return stored.map(sanitize);
  }

  async getServersWithSecrets(userId: string): Promise<McpServerDecrypted[]> {
    const stored = await this.readStored(userId);
    return stored.map((s) => decrypt(s, this.encryptionKey));
  }

  private async readStored(userId: string): Promise<McpServerStored[]> {
    const row = await this.prisma.setting.findFirst({
      where: { userId, key: MCP_SERVERS_SETTING_KEY },
      select: { value: true },
    });
    if (!row?.value) return [];
    const parsed = McpServersSettingSchema.safeParse(row.value);
    if (!parsed.success) {
      // Corrupt row — treat as empty so we don't break the user. Will be overwritten on next save.
      return [];
    }
    return parsed.data.servers as McpServerStored[];
  }

  async saveServers(userId: string, inputRaw: McpServerSaveInput[]): Promise<McpServerPublic[]> {
    const inputs = McpServerSaveInputArraySchema.parse(inputRaw);

    // Uniqueness on name
    const names = new Set<string>();
    for (const i of inputs) {
      if (names.has(i.name)) {
        throw new Error(`Duplicate server name not allowed: ${i.name}`);
      }
      names.add(i.name);
    }

    return this.prisma.$transaction(async (tx) => {
      // Pessimistic lock on the row (idempotent if the row doesn't exist yet)
      await tx.$queryRaw`
        SELECT id FROM "setting"
        WHERE "userId" = ${userId} AND "key" = ${MCP_SERVERS_SETTING_KEY}
        FOR UPDATE
      `;

      const existingRow = await tx.setting.findFirst({
        where: { userId, key: MCP_SERVERS_SETTING_KEY },
        select: { value: true },
      });
      const existingParsed = existingRow?.value
        ? McpServersSettingSchema.safeParse(existingRow.value)
        : null;
      const existing: McpServerStored[] = existingParsed?.success
        ? (existingParsed.data.servers as McpServerStored[])
        : [];
      const existingById = new Map(existing.map((s) => [s.id, s] as const));

      const now = new Date().toISOString();
      const nextServers: McpServerStored[] = inputs.map((i) => {
        const id = i.id ?? uuidV4();
        const prev = i.id ? existingById.get(i.id) : undefined;

        let auth: McpServerStored["auth"];
        if (i.auth.type === "unchanged") {
          if (!prev) {
            throw new Error(`Cannot use unchanged auth for unknown server id: ${id}`);
          }
          auth = prev.auth;
        } else if (i.auth.type === "none") {
          auth = { type: "none" };
        } else if (i.auth.type === "bearer") {
          auth = {
            type: "bearer",
            tokenEncrypted: encryptSecret(i.auth.token, this.encryptionKey),
          };
        } else {
          auth = {
            type: "headers",
            headersEncrypted: i.auth.headers.map((h) => ({
              name: h.name,
              valueEncrypted: encryptSecret(h.value, this.encryptionKey),
            })),
          };
        }

        return {
          id,
          name: i.name,
          url: i.url,
          transport: i.transport,
          auth,
          enabled: i.enabled,
          enabledTools: i.enabledTools,
          description: i.description,
          createdAt: prev?.createdAt ?? now,
          updatedAt: now,
        };
      });

      const blob = McpServersSettingSchema.parse({ version: 1, servers: nextServers });

      await tx.setting.upsert({
        where: { userId_key: { userId, key: MCP_SERVERS_SETTING_KEY } },
        create: {
          userId,
          key: MCP_SERVERS_SETTING_KEY,
          value: blob as unknown as Prisma.InputJsonValue,
        },
        update: { value: blob as unknown as Prisma.InputJsonValue },
      });

      return nextServers.map(sanitize);
    });
  }
}

function sanitize(s: McpServerStored): McpServerPublic {
  let auth: McpServerPublic["auth"];
  if (s.auth.type === "none") {
    auth = { type: "none" };
  } else if (s.auth.type === "bearer") {
    auth = { type: "bearer", hasToken: true };
  } else {
    auth = { type: "headers", headerNames: (s.auth.headersEncrypted ?? []).map((h) => h.name) };
  }
  const { auth: _drop, ...rest } = s;
  return { ...rest, auth };
}

function decrypt(s: McpServerStored, key: string): McpServerDecrypted {
  let auth: McpServerDecrypted["auth"];
  if (s.auth.type === "none") {
    auth = { type: "none" };
  } else if (s.auth.type === "bearer") {
    auth = { type: "bearer", token: decryptSecret(s.auth.tokenEncrypted!, key) };
  } else {
    auth = {
      type: "headers",
      headers: (s.auth.headersEncrypted ?? []).map((h) => ({
        name: h.name,
        value: decryptSecret(h.valueEncrypted, key),
      })),
    };
  }
  const { auth: _drop, ...rest } = s;
  return { ...rest, auth };
}
