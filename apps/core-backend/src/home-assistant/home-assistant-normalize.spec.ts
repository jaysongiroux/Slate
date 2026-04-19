import type { HomeAssistantDashboardSummary } from "@slate/shared";
import {
  buildDashboardEntitySummary,
  extractEntityIdsFromDashboardConfig,
  normalizeHomeAssistantEntity,
} from "./home-assistant-normalize";

describe("Home Assistant normalization helpers", () => {
  it("normalizes a raw light state into an entity summary with friendly name and controls", () => {
    const entity = normalizeHomeAssistantEntity({
      entity_id: "light.living_room",
      state: "on",
      attributes: { friendly_name: "Living Room Lamp", brightness: 128 },
      last_changed: "2026-04-18T05:00:00Z",
      last_updated: "2026-04-18T05:00:10Z",
    });

    expect(entity).toEqual({
      entityId: "light.living_room",
      name: "Living Room Lamp",
      domain: "light",
      areaId: null,
      deviceId: null,
      state: {
        entityId: "light.living_room",
        state: "on",
        attributes: { friendly_name: "Living Room Lamp", brightness: 128 },
        lastChanged: "2026-04-18T05:00:00Z",
        lastUpdated: "2026-04-18T05:00:10Z",
      },
      supportedControls: ["turn_on", "turn_off", "toggle", "light_brightness", "light_color"],
    });
  });

  it("uses entity registry display data to enrich name, area, and device metadata", () => {
    const entity = normalizeHomeAssistantEntity(
      {
        entity_id: "switch.garage",
        state: "off",
        attributes: { friendly_name: "Fallback Name" },
      },
      {
        entity_id: "switch.garage",
        name: "Garage Door Relay",
        area_id: "garage",
        device_id: "device-1",
      },
    );

    expect(entity.name).toBe("Garage Door Relay");
    expect(entity.areaId).toBe("garage");
    expect(entity.deviceId).toBe("device-1");
    expect(entity.supportedControls).toEqual(["turn_on", "turn_off", "toggle"]);
  });

  it("recursively extracts and de-duplicates entity ids from dashboard config", () => {
    const entityIds = extractEntityIdsFromDashboardConfig({
      views: [
        {
          cards: [
            { type: "light", entity: "light.living_room" },
            {
              type: "entities",
              entities: [
                "switch.garage",
                { entity: "climate.hallway" },
                { entity: "light.living_room" },
              ],
            },
            {
              type: "vertical-stack",
              cards: [{ type: "button", entity: "scene.movie_night" }],
            },
          ],
        },
      ],
    });

    expect(entityIds).toEqual([
      "light.living_room",
      "switch.garage",
      "climate.hallway",
      "scene.movie_night",
    ]);
  });

  it("extracts unsupported entities from dashboard card fields beyond standard Lovelace containers", () => {
    const entityIds = extractEntityIdsFromDashboardConfig({
      views: [
        {
          cards: [
            {
              type: "conditional",
              conditions: [{ entity: "media_player.living_room_tv", state: "playing" }],
              card: {
                type: "custom:mini-media-player",
                entity: "media_player.living_room_tv",
              },
            },
          ],
        },
      ],
    });

    expect(entityIds).toEqual(["media_player.living_room_tv"]);
  });

  it("builds a dashboard entity summary from dashboard config and matching states", () => {
    const dashboard: HomeAssistantDashboardSummary = {
      id: "lovelace",
      title: "Overview",
      path: "lovelace",
    };

    const summary = buildDashboardEntitySummary(
      dashboard,
      {
        cards: [
          { entity: "light.living_room" },
          { entity: "sensor.outdoor_temperature" },
          { entity: "light.missing" },
        ],
      },
      [
        {
          entity_id: "light.living_room",
          state: "on",
          attributes: { friendly_name: "Living Room Lamp" },
        },
        {
          entity_id: "sensor.outdoor_temperature",
          state: "62",
          attributes: {},
        },
      ],
      [
        {
          entity_id: "sensor.outdoor_temperature",
          name: "Outdoor Temperature",
          area_id: "patio",
          device_id: "sensor-device",
        },
      ],
    );

    expect(summary.dashboard).toBe(dashboard);
    expect(summary.entities.map((entity) => entity.entityId)).toEqual([
      "light.living_room",
      "sensor.outdoor_temperature",
    ]);
    expect(summary.entities[1]).toEqual(
      expect.objectContaining({
        name: "Outdoor Temperature",
        areaId: "patio",
        deviceId: "sensor-device",
        supportedControls: [],
      }),
    );
  });
});
