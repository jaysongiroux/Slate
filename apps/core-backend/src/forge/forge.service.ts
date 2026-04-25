import { createId } from "@paralleldrive/cuid2";
import type { PrismaClient } from "@prisma/client";
import { Octokit } from "@octokit/rest";
import { Gitlab } from "@gitbeaker/rest";
import {
  FORGE_INSTANCES_SETTING_KEY,
  FORGE_PINNED_ITEMS_SETTING_KEY,
  FORGE_SAVED_SEARCHES_SETTING_KEY,
  FORGE_STARRED_REPOS_SETTING_KEY,
  FORGE_TOKENS_SETTING_KEY,
  type ForgeInstance,
  type ForgePinnedItem,
  type ForgeSavedSearch,
} from "@slate/shared";
import { decryptSecret, encryptSecret } from "../ai/encryption.util";
import { GithubProvider } from "./providers/github.provider";
import { GitlabProvider } from "./providers/gitlab.provider";
import type { ForgeProvider } from "./providers/forge-provider.interface";
import type { AddForgeInstanceInput } from "./forge.types";

type TokenMap = Record<string, string>;
type StarredMap = Record<string, string[]>;

export class ForgeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly encryptionKey: string,
  ) {}

  async listInstances(userId: string): Promise<ForgeInstance[]> {
    const row = await this.prisma.setting.findFirst({
      where: { userId, key: FORGE_INSTANCES_SETTING_KEY },
    });
    return (row?.value as ForgeInstance[] | undefined) ?? [];
  }

  async addInstance(userId: string, input: AddForgeInstanceInput): Promise<ForgeInstance> {
    const normalizedUrl = input.baseUrl.replace(/\/+$/, "");

    const probe = await this.buildProvider(input.provider, normalizedUrl, input.token);
    let validation: { username: string; avatarUrl?: string };
    try {
      validation = await probe.validateToken();
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : "Invalid token");
    }

    const id = createId();
    const instance: ForgeInstance = {
      id,
      name: input.name?.trim() || validation.username || new URL(normalizedUrl).host,
      provider: input.provider,
      baseUrl: normalizedUrl,
      username: validation.username,
      avatarUrl: validation.avatarUrl,
    };

    const encrypted = encryptSecret(input.token, this.encryptionKey);

    const [instancesRow, tokensRow] = await Promise.all([
      this.prisma.setting.findFirst({ where: { userId, key: FORGE_INSTANCES_SETTING_KEY } }),
      this.prisma.setting.findFirst({ where: { userId, key: FORGE_TOKENS_SETTING_KEY } }),
    ]);

    const instances = (instancesRow?.value as ForgeInstance[] | undefined) ?? [];
    const tokens: TokenMap = (tokensRow?.value as TokenMap | undefined) ?? {};
    instances.push(instance);
    tokens[id] = encrypted;

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
              key: FORGE_INSTANCES_SETTING_KEY,
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
              key: FORGE_TOKENS_SETTING_KEY,
              value: tokens as any,
            },
          }),
    ]);

    return instance;
  }

  async updateInstance(
    userId: string,
    id: string,
    patch: Partial<AddForgeInstanceInput>,
  ): Promise<ForgeInstance> {
    const instances = await this.listInstances(userId);
    const existing = instances.find((i) => i.id === id);
    if (!existing) {
      throw Object.assign(new Error("Forge instance not found"), { code: "FORGE_NOT_FOUND" });
    }

    const updated: ForgeInstance = {
      ...existing,
      name: patch.name ?? existing.name,
      baseUrl: patch.baseUrl ? patch.baseUrl.replace(/\/+$/, "") : existing.baseUrl,
      provider: patch.provider ?? existing.provider,
    };
    const next = instances.map((i) => (i.id === id ? updated : i));

    const instancesRow = await this.prisma.setting.findFirst({
      where: { userId, key: FORGE_INSTANCES_SETTING_KEY },
    });
    const ops: any[] = [];
    if (instancesRow) {
      ops.push(
        this.prisma.setting.update({
          where: { id: instancesRow.id },
          data: { value: next as any },
        }),
      );
    }
    if (patch.token) {
      const tokensRow = await this.prisma.setting.findFirst({
        where: { userId, key: FORGE_TOKENS_SETTING_KEY },
      });
      const tokens: TokenMap = (tokensRow?.value as TokenMap | undefined) ?? {};
      tokens[id] = encryptSecret(patch.token, this.encryptionKey);
      if (tokensRow) {
        ops.push(
          this.prisma.setting.update({
            where: { id: tokensRow.id },
            data: { value: tokens as any },
          }),
        );
      } else {
        ops.push(
          this.prisma.setting.create({
            data: {
              id: createId(),
              userId,
              key: FORGE_TOKENS_SETTING_KEY,
              value: tokens as any,
            },
          }),
        );
      }
    }
    if (ops.length > 0) await this.prisma.$transaction(ops);
    return updated;
  }

  async removeInstance(userId: string, id: string): Promise<void> {
    const [instancesRow, tokensRow, pinnedRow, savedRow, starredRow] = await Promise.all([
      this.prisma.setting.findFirst({ where: { userId, key: FORGE_INSTANCES_SETTING_KEY } }),
      this.prisma.setting.findFirst({ where: { userId, key: FORGE_TOKENS_SETTING_KEY } }),
      this.prisma.setting.findFirst({ where: { userId, key: FORGE_PINNED_ITEMS_SETTING_KEY } }),
      this.prisma.setting.findFirst({ where: { userId, key: FORGE_SAVED_SEARCHES_SETTING_KEY } }),
      this.prisma.setting.findFirst({ where: { userId, key: FORGE_STARRED_REPOS_SETTING_KEY } }),
    ]);

    const ops: any[] = [];
    if (instancesRow) {
      const filtered = ((instancesRow.value as unknown as ForgeInstance[] | undefined) ?? []).filter(
        (i) => i.id !== id,
      );
      ops.push(
        this.prisma.setting.update({
          where: { id: instancesRow.id },
          data: { value: filtered as any },
        }),
      );
    }
    if (tokensRow) {
      const tokens: TokenMap = (tokensRow.value as unknown as TokenMap | undefined) ?? {};
      delete tokens[id];
      ops.push(
        this.prisma.setting.update({
          where: { id: tokensRow.id },
          data: { value: tokens as any },
        }),
      );
    }
    if (pinnedRow) {
      const pinned = (
        (pinnedRow.value as unknown as ForgePinnedItem[] | undefined) ?? []
      ).filter((p) => p.instanceId !== id);
      ops.push(
        this.prisma.setting.update({
          where: { id: pinnedRow.id },
          data: { value: pinned as any },
        }),
      );
    }
    if (savedRow) {
      const saved = (
        (savedRow.value as unknown as ForgeSavedSearch[] | undefined) ?? []
      ).filter((s) => s.instanceId !== id);
      ops.push(
        this.prisma.setting.update({
          where: { id: savedRow.id },
          data: { value: saved as any },
        }),
      );
    }
    if (starredRow) {
      const starred: StarredMap = (starredRow.value as unknown as StarredMap | undefined) ?? {};
      delete starred[id];
      ops.push(
        this.prisma.setting.update({
          where: { id: starredRow.id },
          data: { value: starred as any },
        }),
      );
    }
    if (ops.length > 0) await this.prisma.$transaction(ops);
  }

  async getProviderForInstance(userId: string, instanceId: string): Promise<ForgeProvider> {
    const instance = (await this.listInstances(userId)).find((i) => i.id === instanceId);
    if (!instance) {
      throw Object.assign(new Error("Forge instance not found"), { code: "FORGE_NOT_FOUND" });
    }
    const token = await this.decryptTokenForInstance(userId, instanceId);
    return this.buildProvider(instance.provider, instance.baseUrl, token);
  }

  /** Exposed via `protected` so tests can replace with a stub via `(svc as any).buildProvider = ...`. */
  protected async buildProvider(
    provider: "github" | "gitlab",
    baseUrl: string,
    token: string,
  ): Promise<ForgeProvider> {
    if (provider === "github") {
      const octokit = new Octokit({ auth: token, baseUrl });
      return new GithubProvider(octokit, baseUrl);
    }
    const root = baseUrl.replace(/\/api\/v4\/?$/, "");
    const api = new Gitlab({ host: root, token });
    return new GitlabProvider(api as any, baseUrl);
  }

  protected async decryptTokenForInstance(
    userId: string,
    instanceId: string,
  ): Promise<string> {
    const row = await this.prisma.setting.findFirst({
      where: { userId, key: FORGE_TOKENS_SETTING_KEY },
    });
    const tokens: TokenMap = (row?.value as TokenMap | undefined) ?? {};
    const ciphertext = tokens[instanceId];
    if (!ciphertext) throw new Error("Forge token not found");
    return decryptSecret(ciphertext, this.encryptionKey);
  }

  // ------------------------- Pinned -------------------------

  async listPinned(userId: string, instanceId: string): Promise<ForgePinnedItem[]> {
    const row = await this.prisma.setting.findFirst({
      where: { userId, key: FORGE_PINNED_ITEMS_SETTING_KEY },
    });
    const all = (row?.value as ForgePinnedItem[] | undefined) ?? [];
    return all.filter((p) => p.instanceId === instanceId);
  }

  async pin(
    userId: string,
    instanceId: string,
    ref: { kind: "pr" | "issue"; repo: string; number: number },
  ): Promise<ForgePinnedItem> {
    const provider = await this.getProviderForInstance(userId, instanceId);
    const details = await provider.fetchItemDetails(ref.kind, ref.repo, ref.number);

    const row = await this.prisma.setting.findFirst({
      where: { userId, key: FORGE_PINNED_ITEMS_SETTING_KEY },
    });
    const all = (row?.value as ForgePinnedItem[] | undefined) ?? [];

    const pinned: ForgePinnedItem = {
      id: createId(),
      instanceId,
      kind: ref.kind,
      repo: ref.repo,
      number: ref.number,
      title: details.title,
      webUrl: details.webUrl,
      pinnedAt: new Date().toISOString(),
    };
    all.push(pinned);
    await this.upsertSetting(userId, FORGE_PINNED_ITEMS_SETTING_KEY, all, row?.id);
    return pinned;
  }

  async unpin(userId: string, pinId: string): Promise<void> {
    const row = await this.prisma.setting.findFirst({
      where: { userId, key: FORGE_PINNED_ITEMS_SETTING_KEY },
    });
    if (!row) return;
    const next = ((row.value as unknown as ForgePinnedItem[] | undefined) ?? []).filter(
      (p) => p.id !== pinId,
    );
    await this.prisma.setting.update({
      where: { id: row.id },
      data: { value: next as any },
    });
  }

  // ------------------------- Starred -------------------------

  async listStarred(userId: string, instanceId: string): Promise<string[]> {
    const row = await this.prisma.setting.findFirst({
      where: { userId, key: FORGE_STARRED_REPOS_SETTING_KEY },
    });
    const map: StarredMap = (row?.value as StarredMap | undefined) ?? {};
    return map[instanceId] ?? [];
  }

  async star(userId: string, instanceId: string, repo: string): Promise<void> {
    const row = await this.prisma.setting.findFirst({
      where: { userId, key: FORGE_STARRED_REPOS_SETTING_KEY },
    });
    const map: StarredMap = (row?.value as StarredMap | undefined) ?? {};
    const list = map[instanceId] ?? [];
    if (!list.includes(repo)) list.push(repo);
    map[instanceId] = list;
    await this.upsertSetting(userId, FORGE_STARRED_REPOS_SETTING_KEY, map, row?.id);
  }

  async unstar(userId: string, instanceId: string, repo: string): Promise<void> {
    const row = await this.prisma.setting.findFirst({
      where: { userId, key: FORGE_STARRED_REPOS_SETTING_KEY },
    });
    if (!row) return;
    const map: StarredMap = (row.value as unknown as StarredMap | undefined) ?? {};
    map[instanceId] = (map[instanceId] ?? []).filter((r) => r !== repo);
    await this.prisma.setting.update({
      where: { id: row.id },
      data: { value: map as any },
    });
  }

  // ------------------------- Saved searches -------------------------

  async listSavedSearches(userId: string, instanceId: string): Promise<ForgeSavedSearch[]> {
    const row = await this.prisma.setting.findFirst({
      where: { userId, key: FORGE_SAVED_SEARCHES_SETTING_KEY },
    });
    const all = (row?.value as ForgeSavedSearch[] | undefined) ?? [];
    return all.filter((s) => s.instanceId === instanceId);
  }

  async saveSearch(
    userId: string,
    input: Omit<ForgeSavedSearch, "id">,
  ): Promise<ForgeSavedSearch> {
    const row = await this.prisma.setting.findFirst({
      where: { userId, key: FORGE_SAVED_SEARCHES_SETTING_KEY },
    });
    const all = (row?.value as ForgeSavedSearch[] | undefined) ?? [];
    const saved: ForgeSavedSearch = { ...input, id: createId() };
    all.push(saved);
    await this.upsertSetting(userId, FORGE_SAVED_SEARCHES_SETTING_KEY, all, row?.id);
    return saved;
  }

  async removeSavedSearch(userId: string, searchId: string): Promise<void> {
    const row = await this.prisma.setting.findFirst({
      where: { userId, key: FORGE_SAVED_SEARCHES_SETTING_KEY },
    });
    if (!row) return;
    const next = ((row.value as unknown as ForgeSavedSearch[] | undefined) ?? []).filter(
      (s) => s.id !== searchId,
    );
    await this.prisma.setting.update({
      where: { id: row.id },
      data: { value: next as any },
    });
  }

  // ------------------------- Helpers -------------------------

  private async upsertSetting(
    userId: string,
    key: string,
    value: unknown,
    rowId: string | undefined,
  ): Promise<void> {
    if (rowId) {
      await this.prisma.setting.update({
        where: { id: rowId },
        data: { value: value as any },
      });
      return;
    }
    await this.prisma.setting.create({
      data: { id: createId(), userId, key, value: value as any },
    });
  }
}
