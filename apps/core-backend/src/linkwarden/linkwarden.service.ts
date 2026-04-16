import { createId } from "@paralleldrive/cuid2";
import type { PrismaClient } from "@prisma/client";
import {
  LINKWARDEN_INSTANCES_SETTING_KEY,
  LINKWARDEN_TOKENS_SETTING_KEY,
  type LinkwardenInstance,
} from "@slate/shared";
import { encryptSecret, decryptSecret } from "../ai/encryption.util";

export class LinkwardenService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly encryptionKey: string,
  ) {}

  async listInstances(userId: string): Promise<LinkwardenInstance[]> {
    const row = await this.prisma.setting.findFirst({
      where: { userId, key: LINKWARDEN_INSTANCES_SETTING_KEY },
    });
    return (row?.value as LinkwardenInstance[] | undefined) ?? [];
  }

  async addInstance(
    userId: string,
    url: string,
    token: string,
    name?: string,
  ): Promise<LinkwardenInstance> {
    const normalizedUrl = url.replace(/\/+$/, "");

    const testResponse = await fetch(`${normalizedUrl}/api/v1/links?take=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!testResponse.ok) {
      const status = testResponse.status;
      let reason = "";
      try {
        const json = await testResponse.json();
        reason = json?.response ?? json?.message ?? "";
      } catch {
        reason = await testResponse.text().catch(() => "");
      }

      if (status === 401 || status === 403) {
        throw new Error("Invalid access token. Check your token and try again.");
      }
      if (status === 404) {
        throw new Error("LinkWarden API not found at this URL. Check the address and try again.");
      }
      throw new Error(reason || `Could not connect to LinkWarden (HTTP ${status}).`);
    }

    const id = createId();
    const instance: LinkwardenInstance = {
      id,
      name: name?.trim() || new URL(normalizedUrl).host,
      url: normalizedUrl,
    };

    const encryptedToken = encryptSecret(token, this.encryptionKey);

    const instancesRow = await this.prisma.setting.findFirst({
      where: { userId, key: LINKWARDEN_INSTANCES_SETTING_KEY },
    });
    const tokensRow = await this.prisma.setting.findFirst({
      where: { userId, key: LINKWARDEN_TOKENS_SETTING_KEY },
    });

    const instances: LinkwardenInstance[] =
      (instancesRow?.value as LinkwardenInstance[] | undefined) ?? [];
    const tokens: Record<string, string> =
      (tokensRow?.value as Record<string, string> | undefined) ?? {};

    instances.push(instance);
    tokens[id] = encryptedToken;

    await this.prisma.$transaction([
      instancesRow
        ? this.prisma.setting.update({
            where: { id: instancesRow.id },
            data: { value: instances as any },
          })
        : this.prisma.setting.create({
            data: {
              id: createId(),
              userId,
              key: LINKWARDEN_INSTANCES_SETTING_KEY,
              value: instances as any,
            },
          }),
      tokensRow
        ? this.prisma.setting.update({
            where: { id: tokensRow.id },
            data: { value: tokens as any },
          })
        : this.prisma.setting.create({
            data: {
              id: createId(),
              userId,
              key: LINKWARDEN_TOKENS_SETTING_KEY,
              value: tokens as any,
            },
          }),
    ]);

    return instance;
  }

  async removeInstance(userId: string, instanceId: string): Promise<void> {
    const instancesRow = await this.prisma.setting.findFirst({
      where: { userId, key: LINKWARDEN_INSTANCES_SETTING_KEY },
    });
    const tokensRow = await this.prisma.setting.findFirst({
      where: { userId, key: LINKWARDEN_TOKENS_SETTING_KEY },
    });

    const instances: LinkwardenInstance[] =
      (instancesRow?.value as LinkwardenInstance[] | undefined) ?? [];
    const tokens: Record<string, string> =
      (tokensRow?.value as Record<string, string> | undefined) ?? {};

    const filtered = instances.filter((i) => i.id !== instanceId);
    delete tokens[instanceId];

    const ops = [];
    if (instancesRow) {
      ops.push(
        this.prisma.setting.update({
          where: { id: instancesRow.id },
          data: { value: filtered as any },
        }),
      );
    }
    if (tokensRow) {
      ops.push(
        this.prisma.setting.update({
          where: { id: tokensRow.id },
          data: { value: tokens as any },
        }),
      );
    }
    if (ops.length > 0) {
      await this.prisma.$transaction(ops);
    }
  }

  private async getDecryptedToken(
    userId: string,
    instanceId: string,
  ): Promise<{ token: string; instance: LinkwardenInstance }> {
    const instances = await this.listInstances(userId);
    const instance = instances.find((i) => i.id === instanceId);
    if (!instance) throw new Error("LinkWarden instance not found");

    const tokensRow = await this.prisma.setting.findFirst({
      where: { userId, key: LINKWARDEN_TOKENS_SETTING_KEY },
    });
    const tokens: Record<string, string> =
      (tokensRow?.value as Record<string, string> | undefined) ?? {};
    const encrypted = tokens[instanceId];
    if (!encrypted) throw new Error("LinkWarden token not found");

    const token = decryptSecret(encrypted, this.encryptionKey);
    return { token, instance };
  }

  private async proxyGet(userId: string, instanceId: string, path: string): Promise<unknown> {
    const { token, instance } = await this.getDecryptedToken(userId, instanceId);
    const response = await fetch(`${instance.url}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`LinkWarden API error (${response.status}): ${text || response.statusText}`);
    }
    return response.json();
  }

  async proxyRaw(
    userId: string,
    instanceId: string,
    path: string,
  ): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string; status: number }> {
    const { token, instance } = await this.getDecryptedToken(userId, instanceId);
    const response = await fetch(`${instance.url}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return {
      body: response.body,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      status: response.status,
    };
  }

  private async proxyPost(
    userId: string,
    instanceId: string,
    path: string,
    body: unknown,
  ): Promise<unknown> {
    const { token, instance } = await this.getDecryptedToken(userId, instanceId);
    const response = await fetch(`${instance.url}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`LinkWarden API error (${response.status}): ${text || response.statusText}`);
    }
    return response.json();
  }

  async getLinks(
    userId: string,
    instanceId: string,
    opts: {
      collectionId?: number;
      tagId?: number;
      searchQueryString?: string;
      cursor?: number;
      sort?: number;
    } = {},
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (opts.collectionId != null) params.set("collectionId", String(opts.collectionId));
    if (opts.tagId != null) params.set("tagId", String(opts.tagId));
    if (opts.searchQueryString) params.set("searchQueryString", opts.searchQueryString);
    if (opts.cursor != null) params.set("cursor", String(opts.cursor));
    if (opts.sort != null) params.set("sort", String(opts.sort));
    const qs = params.toString();
    return this.proxyGet(userId, instanceId, `/api/v1/links${qs ? `?${qs}` : ""}`);
  }

  async getCollections(userId: string, instanceId: string): Promise<unknown> {
    return this.proxyGet(userId, instanceId, "/api/v1/collections");
  }

  async getTags(userId: string, instanceId: string): Promise<unknown> {
    return this.proxyGet(userId, instanceId, "/api/v1/tags");
  }

  async getDashboard(userId: string, instanceId: string): Promise<unknown> {
    return this.proxyGet(userId, instanceId, "/api/v2/dashboard");
  }

  async createLink(
    userId: string,
    instanceId: string,
    input: {
      url: string;
      name?: string;
      description?: string;
      collection?: { id: number };
      tags?: string[];
    },
  ): Promise<unknown> {
    const body: Record<string, unknown> = { url: input.url };
    if (input.name) body.name = input.name;
    if (input.description) body.description = input.description;
    if (input.collection) body.collection = input.collection;
    if (input.tags) body.tags = input.tags.map((name) => ({ name }));
    return this.proxyPost(userId, instanceId, "/api/v1/links", body);
  }
}
