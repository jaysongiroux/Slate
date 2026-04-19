import { createId } from "@paralleldrive/cuid2";
import type { PrismaClient } from "@prisma/client";
import {
  HOME_ASSISTANT_INSTANCES_SETTING_KEY,
  HOME_ASSISTANT_TOKENS_SETTING_KEY,
  type HomeAssistantAreaSummary,
  type HomeAssistantControlRequest,
  type HomeAssistantControlResult,
  type HomeAssistantDashboardEntitySummary,
  type HomeAssistantDashboardSummary,
  type HomeAssistantDeviceSummary,
  type HomeAssistantEntitySummary,
  type HomeAssistantEntityHistoryResult,
  type HomeAssistantHistoryEntry,
  type HomeAssistantInstance,
  type HomeAssistantLiveStatus,
  type HomeAssistantState,
} from "@slate/shared";
import { decryptSecret, encryptSecret } from "../ai/encryption.util";
import {
  homeAssistantRestGet,
  homeAssistantRestRawGet,
  homeAssistantRestPost,
  normalizeHomeAssistantUrl,
  sendHomeAssistantWebSocketCommand,
  subscribeHomeAssistantStateChanges,
  validateHomeAssistantInstance,
  type HomeAssistantStateChangeHandlers,
  type HomeAssistantWebSocketAdapter,
} from "./home-assistant-client";
import { mapControlToServiceCall } from "./home-assistant-controls";
import {
  buildDashboardEntitySummary,
  normalizeHomeAssistantEntity,
  normalizeHomeAssistantState,
  type HomeAssistantEntityRegistryDisplayEntry,
  type RawHomeAssistantState,
} from "./home-assistant-normalize";

export interface HomeAssistantClient {
  validateInstance(baseUrl: string, token: string): Promise<void>;
  restGet(baseUrl: string, token: string, path: string): Promise<unknown>;
  restRawGet(
    baseUrl: string,
    token: string,
    path: string,
  ): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string; status: number }>;
  restPost(baseUrl: string, token: string, path: string, body: unknown): Promise<unknown>;
  wsCommand(baseUrl: string, token: string, command: Record<string, unknown>): Promise<unknown>;
  subscribeStateChanges(
    baseUrl: string,
    token: string,
    handlers: HomeAssistantStateChangeHandlers,
  ): Promise<() => void>;
}

function createDefaultWebSocketAdapter(url: string): HomeAssistantWebSocketAdapter {
  const socket = new WebSocket(url);
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    onMessage: (handler) => {
      socket.addEventListener("message", (event) => handler(String(event.data)));
    },
    onError: (handler) => {
      socket.addEventListener("error", (event) => handler(event));
    },
    onClose: (handler) => {
      socket.addEventListener("close", () => handler());
    },
  };
}

const defaultHomeAssistantClient: HomeAssistantClient = {
  validateInstance: validateHomeAssistantInstance,
  restGet: homeAssistantRestGet,
  restRawGet: homeAssistantRestRawGet,
  restPost: homeAssistantRestPost,
  wsCommand: (baseUrl, token, command) =>
    sendHomeAssistantWebSocketCommand(baseUrl, token, command, createDefaultWebSocketAdapter),
  subscribeStateChanges: (baseUrl, token, handlers) =>
    subscribeHomeAssistantStateChanges(baseUrl, token, handlers, createDefaultWebSocketAdapter),
};

function hostNameForUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function normalizePanelsToDashboards(raw: unknown): HomeAssistantDashboardSummary[] {
  return Object.entries(asRecord(raw))
    .filter(([, value]) => asRecord(value).component_name === "lovelace")
    .map(([key, value]) => {
      const panel = asRecord(value);
      const path = typeof panel.url_path === "string" && panel.url_path ? panel.url_path : key;
      return {
        id: path,
        title: typeof panel.title === "string" && panel.title ? panel.title : path,
        path,
        icon: typeof panel.icon === "string" ? panel.icon : null,
      };
    });
}

function normalizeAreas(raw: unknown): HomeAssistantAreaSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const area = asRecord(entry);
    const id = area.area_id;
    const name = area.name;
    if (typeof id !== "string" || typeof name !== "string") return [];
    return [{ id, name }];
  });
}

function normalizeDevices(raw: unknown): HomeAssistantDeviceSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const device = asRecord(entry);
    const id = device.id;
    const name =
      typeof device.name_by_user === "string" && device.name_by_user
        ? device.name_by_user
        : device.name;
    if (typeof id !== "string" || typeof name !== "string") return [];
    return [
      {
        id,
        name,
        areaId: typeof device.area_id === "string" ? device.area_id : null,
        manufacturer: typeof device.manufacturer === "string" ? device.manufacturer : null,
        model: typeof device.model === "string" ? device.model : null,
      },
    ];
  });
}

function isRawState(value: unknown): value is RawHomeAssistantState {
  const state = asRecord(value);
  return typeof state.entity_id === "string" && typeof state.state === "string";
}

function isRegistryEntry(value: unknown): value is HomeAssistantEntityRegistryDisplayEntry {
  return typeof asRecord(value).entity_id === "string";
}

/** Matches `isEntityId` in home-assistant-normalize (domain.object_id). */
function isValidHomeAssistantEntityId(entityId: string): boolean {
  return /^[a-z_][a-z0-9_]*\.[a-zA-Z0-9_]+$/.test(entityId);
}

function flattenHistoryStates(raw: unknown): RawHomeAssistantState[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const nested = raw.length > 0 && Array.isArray(raw[0]);
  const flat = nested ? raw.flat() : raw;
  return flat.filter(isRawState);
}

function normalizeHistoryEntries(raw: unknown): HomeAssistantHistoryEntry[] {
  return flattenHistoryStates(raw).map((row) => ({
    entityId: row.entity_id,
    state: row.state,
    lastChanged: row.last_changed ?? "",
    lastUpdated: row.last_updated,
  }));
}

export class HomeAssistantService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly encryptionKey: string,
    private readonly client: HomeAssistantClient = defaultHomeAssistantClient,
  ) {}

  async listInstances(userId: string): Promise<HomeAssistantInstance[]> {
    const row = await this.prisma.setting.findFirst({
      where: { userId, key: HOME_ASSISTANT_INSTANCES_SETTING_KEY },
    });
    return (row?.value as HomeAssistantInstance[] | undefined) ?? [];
  }

  async addInstance(
    userId: string,
    url: string,
    token: string,
    name?: string,
  ): Promise<HomeAssistantInstance> {
    const normalizedUrl = normalizeHomeAssistantUrl(url);
    await this.client.validateInstance(normalizedUrl, token);

    const instance: HomeAssistantInstance = {
      id: createId(),
      name: name?.trim() || hostNameForUrl(normalizedUrl),
      url: normalizedUrl,
    };
    const encryptedToken = encryptSecret(token, this.encryptionKey);

    const instancesRow = await this.prisma.setting.findFirst({
      where: { userId, key: HOME_ASSISTANT_INSTANCES_SETTING_KEY },
    });
    const tokensRow = await this.prisma.setting.findFirst({
      where: { userId, key: HOME_ASSISTANT_TOKENS_SETTING_KEY },
    });
    const instances = (instancesRow?.value as HomeAssistantInstance[] | undefined) ?? [];
    const tokens = (tokensRow?.value as Record<string, string> | undefined) ?? {};

    const nextInstances = [...instances, instance];
    const nextTokens = { ...tokens, [instance.id]: encryptedToken };

    await this.prisma.$transaction([
      instancesRow
        ? this.prisma.setting.update({
            where: { id: instancesRow.id },
            data: { value: nextInstances as any },
          })
        : this.prisma.setting.create({
            data: {
              id: createId(),
              userId,
              key: HOME_ASSISTANT_INSTANCES_SETTING_KEY,
              value: nextInstances as any,
            },
          }),
      tokensRow
        ? this.prisma.setting.update({
            where: { id: tokensRow.id },
            data: { value: nextTokens as any },
          })
        : this.prisma.setting.create({
            data: {
              id: createId(),
              userId,
              key: HOME_ASSISTANT_TOKENS_SETTING_KEY,
              value: nextTokens as any,
            },
          }),
    ]);

    return instance;
  }

  async removeInstance(userId: string, instanceId: string): Promise<void> {
    const instancesRow = await this.prisma.setting.findFirst({
      where: { userId, key: HOME_ASSISTANT_INSTANCES_SETTING_KEY },
    });
    const tokensRow = await this.prisma.setting.findFirst({
      where: { userId, key: HOME_ASSISTANT_TOKENS_SETTING_KEY },
    });
    const instances = (instancesRow?.value as HomeAssistantInstance[] | undefined) ?? [];
    const tokens = (tokensRow?.value as Record<string, string> | undefined) ?? {};

    const nextInstances = instances.filter((instance) => instance.id !== instanceId);
    const nextTokens = { ...tokens };
    delete nextTokens[instanceId];

    const ops = [];
    if (instancesRow) {
      ops.push(
        this.prisma.setting.update({
          where: { id: instancesRow.id },
          data: { value: nextInstances as any },
        }),
      );
    }
    if (tokensRow) {
      ops.push(
        this.prisma.setting.update({
          where: { id: tokensRow.id },
          data: { value: nextTokens as any },
        }),
      );
    }
    if (ops.length > 0) {
      await this.prisma.$transaction(ops);
    }
  }

  private async getInstanceAuth(
    userId: string,
    instanceId: string,
  ): Promise<{ instance: HomeAssistantInstance; token: string }> {
    const instances = await this.listInstances(userId);
    const instance = instances.find((candidate) => candidate.id === instanceId);
    if (!instance) throw new Error("Home Assistant instance not found");

    const tokensRow = await this.prisma.setting.findFirst({
      where: { userId, key: HOME_ASSISTANT_TOKENS_SETTING_KEY },
    });
    const tokens = (tokensRow?.value as Record<string, string> | undefined) ?? {};
    const encryptedToken = tokens[instanceId];
    if (!encryptedToken) throw new Error("Home Assistant token not found");

    return {
      instance,
      token: decryptSecret(encryptedToken, this.encryptionKey),
    };
  }

  async getDashboards(
    userId: string,
    instanceId: string,
  ): Promise<HomeAssistantDashboardSummary[]> {
    const { instance, token } = await this.getInstanceAuth(userId, instanceId);
    const panels = await this.client.wsCommand(instance.url, token, { type: "get_panels" });
    return normalizePanelsToDashboards(panels);
  }

  async getDashboardSummary(
    userId: string,
    instanceId: string,
    dashboardId: string,
  ): Promise<HomeAssistantDashboardEntitySummary> {
    const { instance, token } = await this.getInstanceAuth(userId, instanceId);
    let stale = false;
    let dashboard: HomeAssistantDashboardSummary = {
      id: dashboardId,
      title: dashboardId,
      path: dashboardId,
      icon: null,
    };
    try {
      const dashboards = await this.getDashboards(userId, instanceId);
      dashboard = dashboards.find((candidate) => candidate.id === dashboardId) ?? dashboard;
    } catch {
      stale = true;
    }

    const statesRaw = await this.client.restGet(instance.url, token, "/api/states");
    const states = Array.isArray(statesRaw) ? statesRaw.filter(isRawState) : [];

    let config: unknown = {
      cards: states.map((state) => ({ entity: state.entity_id })),
    };
    let registryRaw: unknown = [];

    try {
      config = await this.client.wsCommand(instance.url, token, {
        type: "lovelace/config",
        url_path: dashboard.path ?? dashboard.id,
      });
    } catch {
      stale = true;
    }

    try {
      registryRaw = await this.client.wsCommand(instance.url, token, {
        type: "config/entity_registry/list",
      });
    } catch {
      stale = true;
    }

    const registryEntries = Array.isArray(registryRaw) ? registryRaw.filter(isRegistryEntry) : [];

    return {
      ...buildDashboardEntitySummary(dashboard, config, states, registryEntries),
      ...(stale ? { stale: true } : {}),
    };
  }

  async getAreas(userId: string, instanceId: string): Promise<HomeAssistantAreaSummary[]> {
    const { instance, token } = await this.getInstanceAuth(userId, instanceId);
    const areas = await this.client.wsCommand(instance.url, token, {
      type: "config/area_registry/list",
    });
    return normalizeAreas(areas);
  }

  async getDevices(userId: string, instanceId: string): Promise<HomeAssistantDeviceSummary[]> {
    const { instance, token } = await this.getInstanceAuth(userId, instanceId);
    const devices = await this.client.wsCommand(instance.url, token, {
      type: "config/device_registry/list",
    });
    return normalizeDevices(devices);
  }

  async getEntities(userId: string, instanceId: string): Promise<HomeAssistantEntitySummary[]> {
    const { instance, token } = await this.getInstanceAuth(userId, instanceId);
    const [statesRaw, registryRaw] = await Promise.all([
      this.client.restGet(instance.url, token, "/api/states"),
      this.client.wsCommand(instance.url, token, {
        type: "config/entity_registry/list",
      }),
    ]);
    const registryByEntityId = new Map(
      (Array.isArray(registryRaw) ? registryRaw.filter(isRegistryEntry) : []).map((entry) => [
        entry.entity_id,
        entry,
      ]),
    );
    return (Array.isArray(statesRaw) ? statesRaw.filter(isRawState) : []).map((state) =>
      normalizeHomeAssistantEntity(state, registryByEntityId.get(state.entity_id)),
    );
  }

  async getEntity(
    userId: string,
    instanceId: string,
    entityId: string,
  ): Promise<HomeAssistantEntitySummary | null> {
    const entities = await this.getEntities(userId, instanceId);
    return entities.find((entity) => entity.entityId === entityId) ?? null;
  }

  async getStates(userId: string, instanceId: string): Promise<HomeAssistantState[]> {
    const { instance, token } = await this.getInstanceAuth(userId, instanceId);
    const states = await this.client.restGet(instance.url, token, "/api/states");
    return Array.isArray(states) ? states.filter(isRawState).map(normalizeHomeAssistantState) : [];
  }

  async getCameraSnapshot(
    userId: string,
    instanceId: string,
    entityId: string,
  ): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string; status: number }> {
    if (!entityId.startsWith("camera.")) {
      throw new Error("unsupported_control");
    }

    const { instance, token } = await this.getInstanceAuth(userId, instanceId);
    return this.client.restRawGet(
      instance.url,
      token,
      `/api/camera_proxy/${encodeURIComponent(entityId)}`,
    );
  }

  async getEntityHistory(
    userId: string,
    instanceId: string,
    entityId: string,
    range: { start: string; end: string },
  ): Promise<HomeAssistantEntityHistoryResult> {
    if (!isValidHomeAssistantEntityId(entityId)) {
      throw new Error("invalid_entity_id");
    }

    const startMs = Date.parse(range.start);
    const endMs = Date.parse(range.end);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs >= endMs) {
      throw new Error("invalid_history_range");
    }

    const { instance, token } = await this.getInstanceAuth(userId, instanceId);
    // HA only exposes `/api/history/period/{start}`; end is `end_time` query (see HistoryPeriodView).
    // significant_changes_only=0 includes every stored update (default 1 drops many sensor samples).
    // Do not send minimal_response: when true, HA returns compact rows without entity_id / full keys;
    // our parser only accepts full state dicts, which would collapse the list to a single row.
    const params = new URLSearchParams({
      filter_entity_id: entityId,
      end_time: range.end,
      significant_changes_only: "0",
    });
    const path = `/api/history/period/${encodeURIComponent(range.start)}?${params.toString()}`;
    const raw = await this.client.restGet(instance.url, token, path);
    return { entries: normalizeHistoryEntries(raw) };
  }

  async testConnection(userId: string, instanceId: string): Promise<void> {
    const { instance, token } = await this.getInstanceAuth(userId, instanceId);
    await this.client.validateInstance(instance.url, token);
  }

  async control(
    userId: string,
    instanceId: string,
    request: HomeAssistantControlRequest,
  ): Promise<HomeAssistantControlResult> {
    const { instance, token } = await this.getInstanceAuth(userId, instanceId);
    const call = mapControlToServiceCall(request);
    const serviceResult = await this.client.restPost(
      instance.url,
      token,
      `/api/services/${call.domain}/${call.service}`,
      call.data,
    );
    const changedState = Array.isArray(serviceResult)
      ? serviceResult.find(
          (state): state is RawHomeAssistantState =>
            isRawState(state) && state.entity_id === request.entityId,
        )
      : null;

    const brightnessOrColorHint =
      request.control === "light_brightness" || request.control === "light_color"
        ? "Home Assistant applies brightness and color with light.turn_on. If the light was off, it is now on at the requested level—do not say the light stayed off or could not be dimmed when this call succeeded."
        : undefined;

    if (changedState) {
      return {
        ok: true,
        state: normalizeHomeAssistantState(changedState),
        ...(brightnessOrColorHint ? { hint: brightnessOrColorHint } : {}),
      };
    }

    if (request.control === "light_brightness" || request.control === "light_color") {
      await new Promise((r) => setTimeout(r, 120));
    }
    const entity = await this.getEntity(userId, instanceId, request.entityId).catch(() => null);
    return {
      ok: true,
      state: entity?.state ?? null,
      ...(brightnessOrColorHint ? { hint: brightnessOrColorHint } : {}),
    };
  }

  async subscribeStateChanges(
    userId: string,
    instanceId: string,
    handlers: {
      onState(state: HomeAssistantState): void;
      onStatus?(status: HomeAssistantLiveStatus): void;
      onError?(error: unknown): void;
    },
  ): Promise<() => void> {
    const { instance, token } = await this.getInstanceAuth(userId, instanceId);
    return this.client.subscribeStateChanges(instance.url, token, {
      onState: (state) => {
        if (isRawState(state)) {
          handlers.onState(normalizeHomeAssistantState(state));
        }
      },
      onStatus: (status) => {
        if (status === "subscribed") {
          handlers.onStatus?.("connected");
        } else if (status === "closed") {
          handlers.onStatus?.("disconnected");
        } else {
          handlers.onStatus?.("connecting");
        }
      },
      onError: handlers.onError,
    });
  }
}
