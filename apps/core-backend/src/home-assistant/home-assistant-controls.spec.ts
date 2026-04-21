import { mapControlToServiceCall, supportedControlsForEntity } from "./home-assistant-controls";

describe("supportedControlsForEntity", () => {
  it("returns the safe controls for lights", () => {
    expect(supportedControlsForEntity("light.living_room")).toEqual([
      "turn_on",
      "turn_off",
      "toggle",
      "light_brightness",
      "light_color",
    ]);
  });

  it.each([
    ["switch.kitchen", ["turn_on", "turn_off", "toggle"]],
    ["fan.ceiling", ["turn_on", "turn_off", "toggle"]],
    ["cover.blinds", ["turn_on", "turn_off", "toggle"]],
    ["climate.downstairs", ["climate_temperature"]],
    ["scene.movie_time", ["scene_run"]],
    ["script.goodnight", ["script_run"]],
  ])("returns the safe controls for %s", (entityId, expected) => {
    expect(supportedControlsForEntity(entityId)).toEqual(expected);
  });

  it("returns an empty list for unsupported domains", () => {
    expect(supportedControlsForEntity("sensor.outside_temperature")).toEqual([]);
  });
});

describe("mapControlToServiceCall", () => {
  it("maps light toggle to light.toggle", () => {
    expect(
      mapControlToServiceCall({
        entityId: "light.living_room",
        control: "toggle",
      }),
    ).toEqual({
      domain: "light",
      service: "toggle",
      data: { entity_id: "light.living_room" },
    });
  });

  it("maps light turn_on to light.turn_on", () => {
    expect(
      mapControlToServiceCall({
        entityId: "light.living_room",
        control: "turn_on",
      }),
    ).toEqual({
      domain: "light",
      service: "turn_on",
      data: { entity_id: "light.living_room" },
    });
  });

  it("maps light turn_off to light.turn_off", () => {
    expect(
      mapControlToServiceCall({
        entityId: "light.living_room",
        control: "turn_off",
      }),
    ).toEqual({
      domain: "light",
      service: "turn_off",
      data: { entity_id: "light.living_room" },
    });
  });

  it("maps light brightness to light.turn_on with brightness_pct", () => {
    expect(
      mapControlToServiceCall({
        entityId: "light.living_room",
        control: "light_brightness",
        value: 72,
      }),
    ).toEqual({
      domain: "light",
      service: "turn_on",
      data: { entity_id: "light.living_room", brightness_pct: 72 },
    });
  });

  it.each(["oops", null, undefined, NaN, -1, 101])(
    "rejects invalid light brightness payloads: %s",
    (value) => {
      expect(() =>
        mapControlToServiceCall({
          entityId: "light.living_room",
          control: "light_brightness",
          value,
        }),
      ).toThrow("unsupported_control");
    },
  );

  it("maps light color to light.turn_on with rgb_color", () => {
    expect(
      mapControlToServiceCall({
        entityId: "light.living_room",
        control: "light_color",
        value: [255, 128, 64],
      }),
    ).toEqual({
      domain: "light",
      service: "turn_on",
      data: { entity_id: "light.living_room", rgb_color: [255, 128, 64] },
    });
  });

  it.each([
    "oops",
    null,
    undefined,
    [],
    [255, , 64],
    [255, 128],
    [255, 128, 64, 1],
    [255, "128", 64],
    [255, NaN, 64],
    [-1, 128, 64],
    [255, 128, 256],
  ])("rejects invalid light color payloads: %s", (value) => {
    expect(() =>
      mapControlToServiceCall({
        entityId: "light.living_room",
        control: "light_color",
        value,
      }),
    ).toThrow("unsupported_control");
  });

  it.each([
    ["switch.kitchen", "turn_on", "turn_on"],
    ["switch.kitchen", "turn_off", "turn_off"],
    ["switch.kitchen", "toggle", "toggle"],
    ["fan.ceiling", "turn_on", "turn_on"],
    ["fan.ceiling", "turn_off", "turn_off"],
    ["fan.ceiling", "toggle", "toggle"],
    ["cover.blinds", "turn_on", "turn_on"],
    ["cover.blinds", "turn_off", "turn_off"],
    ["cover.blinds", "toggle", "toggle"],
  ])("maps %s %s", (entityId, control, service) => {
    expect(
      mapControlToServiceCall({
        entityId,
        control: control as "turn_on" | "turn_off" | "toggle",
      }),
    ).toEqual({
      domain: entityId.split(".")[0],
      service,
      data: { entity_id: entityId },
    });
  });

  it("maps climate temperature to climate.set_temperature with temperature", () => {
    expect(
      mapControlToServiceCall({
        entityId: "climate.downstairs",
        control: "climate_temperature",
        value: 21.5,
      }),
    ).toEqual({
      domain: "climate",
      service: "set_temperature",
      data: { entity_id: "climate.downstairs", temperature: 21.5 },
    });
  });

  it.each(["21", null, undefined, NaN, {}, []])(
    "rejects invalid climate temperature payloads: %s",
    (value) => {
      expect(() =>
        mapControlToServiceCall({
          entityId: "climate.downstairs",
          control: "climate_temperature",
          value,
        }),
      ).toThrow("unsupported_control");
    },
  );

  it("maps scene run to scene.turn_on", () => {
    expect(
      mapControlToServiceCall({
        entityId: "scene.movie_time",
        control: "scene_run",
      }),
    ).toEqual({
      domain: "scene",
      service: "turn_on",
      data: { entity_id: "scene.movie_time" },
    });
  });

  it("maps script run to script.turn_on", () => {
    expect(
      mapControlToServiceCall({
        entityId: "script.goodnight",
        control: "script_run",
      }),
    ).toEqual({
      domain: "script",
      service: "turn_on",
      data: { entity_id: "script.goodnight" },
    });
  });

  it.each([
    [{ entityId: "sensor.outside_temperature", control: "turn_on" }],
    [{ entityId: "light.living_room", control: "scene_run" }],
    [{ entityId: "switch.kitchen", control: "light_color", value: [1, 2, 3] }],
  ])("throws unsupported_control for unsafe mappings", (input) => {
    expect(() => mapControlToServiceCall(input as never)).toThrow("unsupported_control");
  });
});
