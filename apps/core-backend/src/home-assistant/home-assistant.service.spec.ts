import {
  HOME_ASSISTANT_INSTANCES_SETTING_KEY,
  HOME_ASSISTANT_TOKENS_SETTING_KEY,
  type HomeAssistantControlRequest,
} from "@slate/shared";
import { decryptSecret, encryptSecret } from "../ai/encryption.util";
import { HomeAssistantService, type HomeAssistantClient } from "./home-assistant.service";

const ENCRYPTION_KEY = "test-home-assistant-secret";

interface SettingRow {
  id: string;
  userId: string;
  key: string;
  value: unknown;
}

function makePrisma(initialRows: SettingRow[] = []) {
  const rows = [...initialRows];
  const prisma = {
    setting: {
      findFirst: jest.fn(
        async ({ where }: { where: { userId: string; key: string } }) =>
          rows.find((row) => row.userId === where.userId && row.key === where.key) ?? null,
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: { value: unknown } }) => {
          const row = rows.find((entry) => entry.id === where.id);
          if (!row) throw new Error(`missing row ${where.id}`);
          row.value = data.value;
          return row;
        },
      ),
      create: jest.fn(async ({ data }: { data: SettingRow }) => {
        rows.push(data);
        return data;
      }),
    },
    $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
    __rows: rows,
  };
  return prisma;
}

function makeClient(overrides: Partial<HomeAssistantClient> = {}): HomeAssistantClient {
  return {
    validateInstance: jest.fn(async () => undefined),
    restGet: jest.fn(async () => []),
    restRawGet: jest.fn(async () => ({
      body: null,
      contentType: "application/octet-stream",
      status: 404,
    })),
    restPost: jest.fn(async () => ({ ok: true })),
    wsCommand: jest.fn(async () => ({})),
    subscribeStateChanges: jest.fn(async () => () => undefined),
    ...overrides,
  };
}

describe("HomeAssistantService", () => {
  it("adds an instance after validation and stores encrypted tokens separately", async () => {
    const prisma = makePrisma();
    const client = makeClient();
    const service = new HomeAssistantService(prisma as any, ENCRYPTION_KEY, client);

    const instance = await service.addInstance(
      "user-1",
      " http://homeassistant.local:8123/ ",
      "ha-token",
      "Home",
    );

    expect(client.validateInstance).toHaveBeenCalledWith(
      "http://homeassistant.local:8123",
      "ha-token",
    );
    expect(instance).toEqual({
      id: expect.any(String),
      name: "Home",
      url: "http://homeassistant.local:8123",
    });

    const instancesRow = prisma.__rows.find(
      (row) => row.key === HOME_ASSISTANT_INSTANCES_SETTING_KEY,
    );
    const tokensRow = prisma.__rows.find((row) => row.key === HOME_ASSISTANT_TOKENS_SETTING_KEY);
    expect(instancesRow?.value).toEqual([instance]);
    const tokens = tokensRow?.value as Record<string, string>;
    expect(tokens[instance.id]).not.toBe("ha-token");
    expect(decryptSecret(tokens[instance.id], ENCRYPTION_KEY)).toBe("ha-token");
  });

  it("lists only instances for the requested user and never returns tokens", async () => {
    const prisma = makePrisma([
      {
        id: "instances-1",
        userId: "user-1",
        key: HOME_ASSISTANT_INSTANCES_SETTING_KEY,
        value: [{ id: "ha-1", name: "Home", url: "http://ha.local" }],
      },
      {
        id: "instances-2",
        userId: "user-2",
        key: HOME_ASSISTANT_INSTANCES_SETTING_KEY,
        value: [{ id: "ha-2", name: "Other", url: "http://other.local" }],
      },
    ]);
    const service = new HomeAssistantService(prisma as any, ENCRYPTION_KEY, makeClient());

    await expect(service.listInstances("user-1")).resolves.toEqual([
      { id: "ha-1", name: "Home", url: "http://ha.local" },
    ]);
  });

  it("removes instance metadata and its token", async () => {
    const prisma = makePrisma([
      {
        id: "instances",
        userId: "user-1",
        key: HOME_ASSISTANT_INSTANCES_SETTING_KEY,
        value: [
          { id: "ha-1", name: "Home", url: "http://ha.local" },
          { id: "ha-2", name: "Cabin", url: "http://cabin.local" },
        ],
      },
      {
        id: "tokens",
        userId: "user-1",
        key: HOME_ASSISTANT_TOKENS_SETTING_KEY,
        value: { "ha-1": "encrypted-1", "ha-2": "encrypted-2" },
      },
    ]);
    const service = new HomeAssistantService(prisma as any, ENCRYPTION_KEY, makeClient());

    await service.removeInstance("user-1", "ha-1");

    expect(prisma.__rows.find((row) => row.id === "instances")?.value).toEqual([
      { id: "ha-2", name: "Cabin", url: "http://cabin.local" },
    ]);
    expect(prisma.__rows.find((row) => row.id === "tokens")?.value).toEqual({
      "ha-2": "encrypted-2",
    });
  });

  it("lists dashboards from Home Assistant panels", async () => {
    const token = "ha-token";
    const prisma = makePrisma([
      {
        id: "instances",
        userId: "user-1",
        key: HOME_ASSISTANT_INSTANCES_SETTING_KEY,
        value: [{ id: "ha-1", name: "Home", url: "http://ha.local" }],
      },
      {
        id: "tokens",
        userId: "user-1",
        key: HOME_ASSISTANT_TOKENS_SETTING_KEY,
        value: { "ha-1": encryptSecret(token, ENCRYPTION_KEY) },
      },
    ]);
    const client = makeClient({
      wsCommand: jest.fn(async () => ({
        lovelace: { component_name: "lovelace", title: "Overview", url_path: "lovelace" },
        config: { component_name: "config", title: "Settings", url_path: "config" },
        energy: {
          component_name: "lovelace",
          title: "Energy",
          url_path: "energy",
          icon: "mdi:flash",
        },
      })),
    });
    const service = new HomeAssistantService(prisma as any, ENCRYPTION_KEY, client);

    await expect(service.getDashboards("user-1", "ha-1")).resolves.toEqual([
      { id: "lovelace", title: "Overview", path: "lovelace", icon: null },
      { id: "energy", title: "Energy", path: "energy", icon: "mdi:flash" },
    ]);
    expect(client.wsCommand).toHaveBeenCalledWith("http://ha.local", token, { type: "get_panels" });
  });

  it("builds dashboard summaries from config, states, and registry entries", async () => {
    const prisma = makePrisma([
      {
        id: "instances",
        userId: "user-1",
        key: HOME_ASSISTANT_INSTANCES_SETTING_KEY,
        value: [{ id: "ha-1", name: "Home", url: "http://ha.local" }],
      },
      {
        id: "tokens",
        userId: "user-1",
        key: HOME_ASSISTANT_TOKENS_SETTING_KEY,
        value: { "ha-1": encryptSecret("ha-token", ENCRYPTION_KEY) },
      },
    ]);
    const client = makeClient({
      wsCommand: jest.fn(async (_url, _token, command) => {
        if (command.type === "get_panels") {
          return {
            lovelace: { component_name: "lovelace", title: "Overview", url_path: "lovelace" },
          };
        }
        if (command.type === "lovelace/config") {
          return { cards: [{ entity: "light.living_room" }] };
        }
        if (command.type === "config/entity_registry/list") {
          return [
            { entity_id: "light.living_room", area_id: "living_room", device_id: "device-1" },
          ];
        }
        return {};
      }),
      restGet: jest.fn(async () => [
        {
          entity_id: "light.living_room",
          state: "on",
          attributes: { friendly_name: "Living Room Lamp" },
        },
      ]),
    });
    const service = new HomeAssistantService(prisma as any, ENCRYPTION_KEY, client);

    const summary = await service.getDashboardSummary("user-1", "ha-1", "lovelace");

    expect(summary.dashboard).toEqual({
      id: "lovelace",
      title: "Overview",
      path: "lovelace",
      icon: null,
    });
    expect(summary.entities[0]).toEqual(
      expect.objectContaining({
        entityId: "light.living_room",
        name: "Living Room Lamp",
        areaId: "living_room",
        deviceId: "device-1",
      }),
    );
    expect(client.restGet).toHaveBeenCalledWith("http://ha.local", "ha-token", "/api/states");
  });

  it("enriches entity summaries with device ids from the full entity registry", async () => {
    const prisma = makePrisma([
      {
        id: "instances",
        userId: "user-1",
        key: HOME_ASSISTANT_INSTANCES_SETTING_KEY,
        value: [{ id: "ha-1", name: "Home", url: "http://ha.local" }],
      },
      {
        id: "tokens",
        userId: "user-1",
        key: HOME_ASSISTANT_TOKENS_SETTING_KEY,
        value: { "ha-1": encryptSecret("ha-token", ENCRYPTION_KEY) },
      },
    ]);
    const client = makeClient({
      wsCommand: jest.fn(async (_url, _token, command) => {
        if (command.type === "config/entity_registry/list") {
          return [
            {
              entity_id: "light.living_room",
              name: null,
              original_name: "Living Room Corner Light",
              area_id: "living_room",
              device_id: "device-1",
            },
          ];
        }
        return {};
      }),
      restGet: jest.fn(async () => [
        {
          entity_id: "light.living_room",
          state: "on",
          attributes: { friendly_name: "Fallback Lamp" },
        },
      ]),
    });
    const service = new HomeAssistantService(prisma as any, ENCRYPTION_KEY, client);

    const entities = await service.getEntities("user-1", "ha-1");

    expect(client.wsCommand).toHaveBeenCalledWith("http://ha.local", "ha-token", {
      type: "config/entity_registry/list",
    });
    expect(entities[0]).toEqual(
      expect.objectContaining({
        entityId: "light.living_room",
        name: "Living Room Corner Light",
        areaId: "living_room",
        deviceId: "device-1",
      }),
    );
  });

  it("returns normalized state payloads", async () => {
    const prisma = makePrisma([
      {
        id: "instances",
        userId: "user-1",
        key: HOME_ASSISTANT_INSTANCES_SETTING_KEY,
        value: [{ id: "ha-1", name: "Home", url: "http://ha.local" }],
      },
      {
        id: "tokens",
        userId: "user-1",
        key: HOME_ASSISTANT_TOKENS_SETTING_KEY,
        value: { "ha-1": encryptSecret("ha-token", ENCRYPTION_KEY) },
      },
    ]);
    const client = makeClient({
      restGet: jest.fn(async () => [
        {
          entity_id: "switch.outlet",
          state: "off",
          attributes: { friendly_name: "Outlet" },
          last_changed: "2026-04-18T12:00:00Z",
          last_updated: "2026-04-18T12:00:01Z",
        },
      ]),
    });
    const service = new HomeAssistantService(prisma as any, ENCRYPTION_KEY, client);

    await expect(service.getStates("user-1", "ha-1")).resolves.toEqual([
      {
        entityId: "switch.outlet",
        state: "off",
        attributes: { friendly_name: "Outlet" },
        lastChanged: "2026-04-18T12:00:00Z",
        lastUpdated: "2026-04-18T12:00:01Z",
      },
    ]);
  });

  it("returns a stale dashboard summary from REST states when live WebSocket data is unavailable", async () => {
    const prisma = makePrisma([
      {
        id: "instances",
        userId: "user-1",
        key: HOME_ASSISTANT_INSTANCES_SETTING_KEY,
        value: [{ id: "ha-1", name: "Home", url: "http://ha.local" }],
      },
      {
        id: "tokens",
        userId: "user-1",
        key: HOME_ASSISTANT_TOKENS_SETTING_KEY,
        value: { "ha-1": encryptSecret("ha-token", ENCRYPTION_KEY) },
      },
    ]);
    const client = makeClient({
      wsCommand: jest.fn(async () => {
        throw new Error("websocket_unavailable");
      }),
      restGet: jest.fn(async () => [
        {
          entity_id: "switch.outlet",
          state: "on",
          attributes: { friendly_name: "Outlet" },
        },
      ]),
    });
    const service = new HomeAssistantService(prisma as any, ENCRYPTION_KEY, client);

    await expect(service.getDashboardSummary("user-1", "ha-1", "overview")).resolves.toEqual({
      dashboard: { id: "overview", title: "overview", path: "overview", icon: null },
      stale: true,
      entities: [
        expect.objectContaining({
          entityId: "switch.outlet",
          name: "Outlet",
          supportedControls: ["turn_on", "turn_off", "toggle"],
        }),
      ],
    });
  });

  it("maps safe controls to REST service calls", async () => {
    const prisma = makePrisma([
      {
        id: "instances",
        userId: "user-1",
        key: HOME_ASSISTANT_INSTANCES_SETTING_KEY,
        value: [{ id: "ha-1", name: "Home", url: "http://ha.local" }],
      },
      {
        id: "tokens",
        userId: "user-1",
        key: HOME_ASSISTANT_TOKENS_SETTING_KEY,
        value: { "ha-1": encryptSecret("ha-token", ENCRYPTION_KEY) },
      },
    ]);
    const client = makeClient();
    const service = new HomeAssistantService(prisma as any, ENCRYPTION_KEY, client);
    const request: HomeAssistantControlRequest = {
      entityId: "light.living_room",
      control: "toggle",
    };

    await expect(service.control("user-1", "ha-1", request)).resolves.toEqual({
      ok: true,
      state: null,
    });
    expect(client.restPost).toHaveBeenCalledWith(
      "http://ha.local",
      "ha-token",
      "/api/services/light/toggle",
      { entity_id: "light.living_room" },
    );
  });

  it("proxies camera snapshots through the Home Assistant camera proxy", async () => {
    const prisma = makePrisma([
      {
        id: "instances",
        userId: "user-1",
        key: HOME_ASSISTANT_INSTANCES_SETTING_KEY,
        value: [{ id: "ha-1", name: "Home", url: "http://ha.local" }],
      },
      {
        id: "tokens",
        userId: "user-1",
        key: HOME_ASSISTANT_TOKENS_SETTING_KEY,
        value: { "ha-1": encryptSecret("ha-token", ENCRYPTION_KEY) },
      },
    ]);
    const client = makeClient({
      restRawGet: jest.fn(async () => ({
        body: null,
        contentType: "image/jpeg",
        status: 200,
      })),
    });
    const service = new HomeAssistantService(prisma as any, ENCRYPTION_KEY, client);

    await expect(service.getCameraSnapshot("user-1", "ha-1", "camera.front_door")).resolves.toEqual(
      {
        body: null,
        contentType: "image/jpeg",
        status: 200,
      },
    );
    expect(client.restRawGet).toHaveBeenCalledWith(
      "http://ha.local",
      "ha-token",
      "/api/camera_proxy/camera.front_door",
    );
  });
});
