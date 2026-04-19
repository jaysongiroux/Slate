import { createControlHomeAssistantEntityTool } from "./control-home-assistant-entity.tool";
import { createGetHomeAssistantEntityTool } from "./get-home-assistant-entity.tool";
import { createListHomeAssistantInstancesTool } from "./list-home-assistant-instances.tool";
import { createSearchHomeAssistantDevicesTool } from "./search-home-assistant-devices.tool";
import { createSearchHomeAssistantEntitiesTool } from "./search-home-assistant-entities.tool";

const userId = "user-1";

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
    expect(JSON.parse(result as string)).toEqual([{ id: "ha-1", name: "Home", url: "http://ha" }]);
  });

  it("searches entities for an instance and returns capped compact results", async () => {
    const service = makeHomeAssistantService();
    const tool = createSearchHomeAssistantEntitiesTool(service, userId);

    const result = await tool.invoke({ instanceId: "ha-1", query: "kitchen", limit: 1 });
    const parsed = JSON.parse(result as string);

    expect(service.getEntities).toHaveBeenCalledWith(userId, "ha-1");
    expect(parsed).toEqual({
      query: "kitchen",
      totalMatches: 1,
      returned: 1,
      truncated: false,
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
    expect(result).not.toContain("attributes");
  });

  it("searches devices for an instance and returns capped compact results", async () => {
    const service = makeHomeAssistantService();
    const tool = createSearchHomeAssistantDevicesTool(service, userId);

    const result = await tool.invoke({ instanceId: "ha-1", query: "lamp", limit: 1 });
    const parsed = JSON.parse(result as string);

    expect(service.getDevices).toHaveBeenCalledWith(userId, "ha-1");
    expect(parsed).toEqual({
      query: "lamp",
      totalMatches: 1,
      returned: 1,
      truncated: false,
      devices: [{ id: "device-1", name: "Living Room Lamp" }],
    });
  });

  it("gets one entity by entity id", async () => {
    const service = makeHomeAssistantService();
    const tool = createGetHomeAssistantEntityTool(service, userId);

    const result = await tool.invoke({ instanceId: "ha-1", entityId: "light.kitchen" });

    expect(service.getEntity).toHaveBeenCalledWith(userId, "ha-1", "light.kitchen");
    expect(JSON.parse(result as string).entityId).toBe("light.kitchen");
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
    expect(JSON.parse(result as string)).toEqual({ ok: true, state: null });
  });
});
