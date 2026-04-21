import { createControlHomeAssistantEntityTool } from "./control-home-assistant-entity.tool";
import { createGetHomeAssistantEntityTool } from "./get-home-assistant-entity.tool";
import { createListHomeAssistantInstancesTool } from "./list-home-assistant-instances.tool";
import { createSearchHomeAssistantDevicesTool } from "./search-home-assistant-devices.tool";
import { createSearchHomeAssistantEntitiesTool } from "./search-home-assistant-entities.tool";
import { createListHomeAssistantDeviceEntitiesTool } from "./list-home-assistant-device-entities.tool";

const userId = "user-1";

function toolInvokeString(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  if (
    result != null &&
    typeof result === "object" &&
    "content" in result &&
    typeof (result as { content: unknown }).content === "string"
  ) {
    return (result as { content: string }).content;
  }
  throw new Error(`Unexpected tool invoke result: ${String(result)}`);
}

function makeHomeAssistantService(overrides: Record<string, unknown> = {}) {
  return {
    listInstances: jest.fn().mockResolvedValue([{ id: "ha-1", name: "Home", url: "http://ha" }]),
    getDevices: jest.fn().mockResolvedValue([{ id: "device-1", name: "Living Room Lamp" }]),
    getEntities: jest.fn().mockResolvedValue([
      {
        entityId: "light.kitchen",
        name: "Kitchen",
        domain: "light",
        state: {
          entityId: "light.kitchen",
          state: "off",
          attributes: { huge: "metadata that should not be returned by search" },
        },
        supportedControls: ["turn_on", "turn_off", "toggle"],
      },
    ]),
    getEntity: jest.fn().mockResolvedValue({ entityId: "light.kitchen", name: "Kitchen" }),
    control: jest.fn().mockResolvedValue({ ok: true, state: null }),
    getAreas: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}

describe("Home Assistant AI tools", () => {
  it("uses the safe starter tool names", () => {
    const service = makeHomeAssistantService();
    expect(createListHomeAssistantInstancesTool(service, userId).name).toBe(
      "list_home_assistant_instances",
    );
    expect(createSearchHomeAssistantEntitiesTool(service, userId).name).toBe(
      "search_home_assistant_entities",
    );
    expect(createSearchHomeAssistantDevicesTool(service, userId).name).toBe(
      "search_home_assistant_devices",
    );
    expect(createListHomeAssistantDeviceEntitiesTool(service, userId).name).toBe(
      "list_home_assistant_device_entities",
    );
    expect(createGetHomeAssistantEntityTool(service, userId).name).toBe(
      "get_home_assistant_entity",
    );
    expect(createControlHomeAssistantEntityTool(service, userId).name).toBe(
      "control_home_assistant_entity",
    );
  });

  it("lists instances for the current user", async () => {
    const service = makeHomeAssistantService();
    const tool = createListHomeAssistantInstancesTool(service, userId);

    const result = await tool.invoke({});

    expect(service.listInstances).toHaveBeenCalledWith(userId);
    expect(JSON.parse(toolInvokeString(result))).toEqual([
      { id: "ha-1", name: "Home", url: "http://ha" },
    ]);
  });

  it("searches entities for an instance and returns capped compact results", async () => {
    const service = makeHomeAssistantService();
    const tool = createSearchHomeAssistantEntitiesTool(service, userId);

    const result = await tool.invoke({
      instanceId: "ha-1",
      query: "kitchen",
      domain: null,
      areaId: null,
      deviceId: null,
      controllableOnly: null,
      limit: 1,
    });
    const parsed = JSON.parse(toolInvokeString(result));

    expect(service.getEntities).toHaveBeenCalledWith(userId, "ha-1");
    expect(parsed).toEqual({
      query: "kitchen",
      totalMatches: 1,
      returned: 1,
      truncated: false,
      relaxedFallback: false,
      entities: [
        {
          entityId: "light.kitchen",
          name: "Kitchen",
          domain: "light",
          state: "off",
          supportedControls: ["turn_on", "turn_off", "toggle"],
        },
      ],
    });
    expect(toolInvokeString(result)).not.toContain("attributes");
  });

  it("rejects unknown instance id before calling Home Assistant", async () => {
    const service = makeHomeAssistantService();
    const tool = createSearchHomeAssistantEntitiesTool(service, userId);

    const result = await tool.invoke({
      instanceId: "default",
      query: "kitchen",
      domain: null,
      areaId: null,
      deviceId: null,
      controllableOnly: null,
      limit: 5,
    });

    const parsed = JSON.parse(toolInvokeString(result));
    expect(parsed.error).toBe("unknown_instance_id");
    expect(parsed.validInstances).toEqual([{ id: "ha-1", name: "Home" }]);
    expect(service.getEntities).not.toHaveBeenCalled();
  });

  it("accepts OpenAI-style wrapped tool call input (args nested)", async () => {
    const service = makeHomeAssistantService();
    const tool = createSearchHomeAssistantEntitiesTool(service, userId);

    const result = await tool.invoke({
      name: "search_home_assistant_entities",
      args: {
        instanceId: "ha-1",
        query: "kitchen",
        domain: "light",
        controllableOnly: true,
        limit: 5,
      },
      id: "call_test",
      type: "tool_call",
    } as any);

    const parsed = JSON.parse(toolInvokeString(result));
    expect(service.getEntities).toHaveBeenCalledWith(userId, "ha-1");
    expect(parsed.totalMatches).toBe(1);
  });

  it("lists entities linked to a device id with unit and device class when present", async () => {
    const service = makeHomeAssistantService({
      getEntities: jest.fn().mockResolvedValue([
        {
          entityId: "sensor.air_temperature",
          name: "Temperature",
          domain: "sensor",
          deviceId: "device-air",
          state: {
            entityId: "sensor.air_temperature",
            state: "22.1",
            lastUpdated: "2024-01-01T00:00:12.000Z",
            attributes: { unit_of_measurement: "°C", device_class: "temperature" },
          },
          supportedControls: [],
        },
        {
          entityId: "sensor.air_battery",
          name: "Battery",
          domain: "sensor",
          deviceId: "device-air",
          state: {
            entityId: "sensor.air_battery",
            state: "100",
            lastUpdated: "2024-01-01T00:00:00.000Z",
            attributes: { unit_of_measurement: "%", device_class: "battery" },
          },
          supportedControls: [],
        },
        {
          entityId: "light.other",
          name: "Other",
          domain: "light",
          deviceId: "other-device",
          state: { entityId: "light.other", state: "off", attributes: {} },
          supportedControls: ["turn_on", "turn_off"],
        },
      ]),
    });
    const tool = createListHomeAssistantDeviceEntitiesTool(service, userId);

    const result = await tool.invoke({
      instanceId: "ha-1",
      deviceId: "device-air",
      limit: null,
    });
    const parsed = JSON.parse(toolInvokeString(result));

    expect(service.getEntities).toHaveBeenCalledWith(userId, "ha-1");
    expect(parsed.deviceId).toBe("device-air");
    expect(parsed.totalEntities).toBe(2);
    expect(parsed.returned).toBe(2);
    expect(parsed.truncated).toBe(false);
    expect(parsed.entities).toEqual([
      {
        entityId: "sensor.air_temperature",
        name: "Temperature",
        domain: "sensor",
        state: "22.1",
        unit: "°C",
        deviceClass: "temperature",
        lastUpdated: "2024-01-01T00:00:12.000Z",
        supportedControls: [],
      },
      {
        entityId: "sensor.air_battery",
        name: "Battery",
        domain: "sensor",
        state: "100",
        unit: "%",
        deviceClass: "battery",
        lastUpdated: "2024-01-01T00:00:00.000Z",
        supportedControls: [],
      },
    ]);
  });

  it("surfaces temperature and humidity from attributes when integrations nest readings there", async () => {
    const service = makeHomeAssistantService({
      getEntities: jest.fn().mockResolvedValue([
        {
          entityId: "sensor.qingping_air_monitor",
          name: "Air Monitor",
          domain: "sensor",
          deviceId: "device-air",
          state: {
            entityId: "sensor.qingping_air_monitor",
            state: "measuring",
            lastUpdated: "2024-01-01T00:00:12.000Z",
            attributes: {
              temperature: 22.1,
              humidity: 48.2,
              unit_of_measurement: "°C",
              device_class: "temperature",
            },
          },
          supportedControls: [],
        },
      ]),
    });
    const tool = createListHomeAssistantDeviceEntitiesTool(service, userId);

    const result = await tool.invoke({
      instanceId: "ha-1",
      deviceId: "device-air",
      limit: null,
    });
    const parsed = JSON.parse(toolInvokeString(result));

    expect(parsed.entities[0].readings).toEqual({ temperature: 22.1, humidity: 48.2 });
    expect(parsed.entities[0].state).toBe("measuring");
  });

  it("searches devices for an instance and returns capped compact results", async () => {
    const service = makeHomeAssistantService();
    const tool = createSearchHomeAssistantDevicesTool(service, userId);

    const result = await tool.invoke({
      instanceId: "ha-1",
      query: "lamp",
      areaId: null,
      limit: 1,
    });
    const parsed = JSON.parse(toolInvokeString(result));

    expect(service.getDevices).toHaveBeenCalledWith(userId, "ha-1");
    expect(parsed).toEqual({
      query: "lamp",
      totalMatches: 1,
      returned: 1,
      truncated: false,
      relaxedFallback: false,
      devices: [{ id: "device-1", name: "Living Room Lamp" }],
    });
  });

  it("gets one entity by entity id", async () => {
    const service = makeHomeAssistantService();
    const tool = createGetHomeAssistantEntityTool(service, userId);

    const result = await tool.invoke({ instanceId: "ha-1", entityId: "light.kitchen" });

    expect(service.getEntity).toHaveBeenCalledWith(userId, "ha-1", "light.kitchen");
    expect(JSON.parse(toolInvokeString(result)).entityId).toBe("light.kitchen");
  });

  it("controls entities only through the safe control request shape", async () => {
    const service = makeHomeAssistantService();
    const tool = createControlHomeAssistantEntityTool(service, userId);

    const result = await tool.invoke({
      instanceId: "ha-1",
      entityId: "light.kitchen",
      control: "light_brightness",
      value: 40,
    });

    expect(service.control).toHaveBeenCalledWith(userId, "ha-1", {
      entityId: "light.kitchen",
      control: "light_brightness",
      value: 40,
    });
    expect(JSON.parse(toolInvokeString(result))).toEqual({ ok: true, state: null });
  });
});
