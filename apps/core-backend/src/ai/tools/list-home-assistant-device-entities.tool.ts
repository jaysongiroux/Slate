import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { HomeAssistantEntitySummary } from "@slate/shared";
import type { HomeAssistantService } from "../../home-assistant/home-assistant.service";
import { formatHomeAssistantError } from "../../home-assistant/home-assistant.errors";
import { clampHomeAssistantSearchLimit } from "./home-assistant-search-utils";
import { unwrapLangChainToolCallInput } from "./langchain-tool-input";
import { homeAssistantInstanceOrErrorJson } from "./home-assistant-instance-guard";

/** Many integrations (e.g. air quality) expose multiple readings only in attributes. */
const MEASUREMENT_ATTR_KEYS = new Set([
  "temperature",
  "temp",
  "current_temperature",
  "humidity",
  "pressure",
  "co2",
  "carbon_dioxide",
  "pm25",
  "pm2_5",
  "pm10",
  "pm1",
  "tvoc",
  "voc",
  "noise",
  "aqi",
  "formaldehyde",
  "nox",
  "battery_level",
  "battery_voltage",
  "illuminance",
]);

function measurementReadingsFromAttributes(
  attrs: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const key of MEASUREMENT_ATTR_KEYS) {
    if (key in attrs && attrs[key] != null && attrs[key] !== "") {
      out[key] = attrs[key];
    }
  }
  for (const [key, value] of Object.entries(attrs)) {
    if (out[key] !== undefined || value == null || value === "") {
      continue;
    }
    if (
      /^(current_)?(temp|temperature|humidity|pm|co2|tvoc|voc|pressure|noise|formaldehyde|nox|aqi|battery|illuminance)/i.test(
        key,
      )
    ) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function compactEntityForDevice(entity: HomeAssistantEntitySummary) {
  const attrs = entity.state?.attributes ?? {};
  const unit =
    typeof attrs.unit_of_measurement === "string" ? attrs.unit_of_measurement : undefined;
  const deviceClass = typeof attrs.device_class === "string" ? attrs.device_class : undefined;
  const readings = measurementReadingsFromAttributes(attrs as Record<string, unknown>);
  return {
    entityId: entity.entityId,
    name: entity.name,
    domain: entity.domain,
    state: entity.state?.state ?? "unknown",
    ...(unit ? { unit } : {}),
    ...(deviceClass ? { deviceClass } : {}),
    ...(readings ? { readings } : {}),
    ...(entity.state?.lastUpdated ? { lastUpdated: entity.state.lastUpdated } : {}),
    supportedControls: entity.supportedControls,
  };
}

function lastUpdatedMs(entity: HomeAssistantEntitySummary): number {
  const raw = entity.state?.lastUpdated;
  if (!raw) {
    return 0;
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

export function createListHomeAssistantDeviceEntitiesTool(
  homeAssistantService: HomeAssistantService,
  userId: string,
) {
  return (tool as any)(
    async (input: { instanceId: string; deviceId: string; limit: number | null | undefined }) => {
      try {
        const guard = await homeAssistantInstanceOrErrorJson(
          homeAssistantService,
          userId,
          input.instanceId,
        );
        if (!guard.ok) {
          return guard.body;
        }

        const limit = clampHomeAssistantSearchLimit(input.limit, 80, 120);
        const entities = await homeAssistantService.getEntities(userId, input.instanceId);
        const forDevice = entities
          .filter((e) => e.deviceId === input.deviceId)
          .sort((a, b) => {
            const t = lastUpdatedMs(b) - lastUpdatedMs(a);
            if (t !== 0) {
              return t;
            }
            return a.entityId.localeCompare(b.entityId);
          });
        const truncated = forDevice.length > limit;
        const slice = forDevice.slice(0, limit);

        return JSON.stringify({
          deviceId: input.deviceId,
          totalEntities: forDevice.length,
          returned: slice.length,
          truncated,
          entities: slice.map(compactEntityForDevice),
        });
      } catch (err) {
        return `Home Assistant error: ${formatHomeAssistantError(err).message}`;
      }
    },
    {
      name: "list_home_assistant_device_entities",
      description:
        "Lists entities registered to a Home Assistant device id. Results are sorted by most recently updated first (live sensors appear at the top). Temperature and other readings may appear in the readings field when the integration puts them in attributes, or in state. If truncated, increase limit. Use after search_home_assistant_devices; pass the device id from those results.",
      schema: z.preprocess(
        unwrapLangChainToolCallInput,
        z.object({
          instanceId: z
            .string()
            .describe("Exact id from list_home_assistant_instances (never default or guessed)"),
          deviceId: z
            .string()
            .min(1)
            .describe("Home Assistant device id from search_home_assistant_devices or the UI"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(120)
            .nullish()
            .describe("Max entities to return (default 80, max 120); raise if truncated"),
        }),
      ),
    },
  );
}
