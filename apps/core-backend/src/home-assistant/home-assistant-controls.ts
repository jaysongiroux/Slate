import type { HomeAssistantControlKind, HomeAssistantControlRequest } from "@slate/shared";

export interface HomeAssistantServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
}

const LIGHT_CONTROLS: HomeAssistantControlKind[] = [
  "turn_on",
  "turn_off",
  "toggle",
  "light_brightness",
  "light_color",
];

const SIMPLE_SWITCH_CONTROLS: HomeAssistantControlKind[] = ["turn_on", "turn_off", "toggle"];

const CLIMATE_CONTROLS: HomeAssistantControlKind[] = ["climate_temperature"];
const SCENE_CONTROLS: HomeAssistantControlKind[] = ["scene_run"];
const SCRIPT_CONTROLS: HomeAssistantControlKind[] = ["script_run"];

function getDomain(entityId: string): string {
  const index = entityId.indexOf(".");
  return index >= 0 ? entityId.slice(0, index) : "";
}

export function supportedControlsForEntity(entityId: string): HomeAssistantControlKind[] {
  switch (getDomain(entityId)) {
    case "light":
      return [...LIGHT_CONTROLS];
    case "switch":
    case "fan":
    case "cover":
      return [...SIMPLE_SWITCH_CONTROLS];
    case "climate":
      return [...CLIMATE_CONTROLS];
    case "scene":
      return [...SCENE_CONTROLS];
    case "script":
      return [...SCRIPT_CONTROLS];
    default:
      return [];
  }
}

function unsupportedControl(): never {
  throw new Error("unsupported_control");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidBrightness(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 100;
}

function isValidRgbColor(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    [0, 1, 2].every(
      (index) =>
        Object.prototype.hasOwnProperty.call(value, index) &&
        isFiniteNumber(value[index]) &&
        value[index] >= 0 &&
        value[index] <= 255,
    )
  );
}

function ensureSupportedControl(entityId: string, control: HomeAssistantControlKind): string {
  const domain = getDomain(entityId);
  const supportedControls = supportedControlsForEntity(entityId);

  if (!domain || !supportedControls.includes(control)) {
    unsupportedControl();
  }

  return domain;
}

export function mapControlToServiceCall(
  input: HomeAssistantControlRequest,
): HomeAssistantServiceCall {
  const domain = ensureSupportedControl(input.entityId, input.control);
  const entityId = input.entityId;

  switch (input.control) {
    case "turn_on":
    case "turn_off":
    case "toggle":
      if (domain === "light" || domain === "switch" || domain === "fan" || domain === "cover") {
        return {
          domain,
          service: input.control,
          data: { entity_id: entityId },
        };
      }
      break;
    case "light_brightness":
      if (!isValidBrightness(input.value)) {
        unsupportedControl();
      }
      return {
        domain: "light",
        service: "turn_on",
        data: { entity_id: entityId, brightness_pct: input.value },
      };
    case "light_color":
      if (!isValidRgbColor(input.value)) {
        unsupportedControl();
      }
      return {
        domain: "light",
        service: "turn_on",
        data: { entity_id: entityId, rgb_color: input.value },
      };
    case "climate_temperature":
      if (!isFiniteNumber(input.value)) {
        unsupportedControl();
      }
      return {
        domain: "climate",
        service: "set_temperature",
        data: { entity_id: entityId, temperature: input.value },
      };
    case "scene_run":
      return {
        domain: "scene",
        service: "turn_on",
        data: { entity_id: entityId },
      };
    case "script_run":
      return {
        domain: "script",
        service: "turn_on",
        data: { entity_id: entityId },
      };
  }

  unsupportedControl();
}
