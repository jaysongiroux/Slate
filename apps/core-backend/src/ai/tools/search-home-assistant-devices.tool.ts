import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { HomeAssistantDeviceSummary } from "@slate/shared";
import type { HomeAssistantService } from "../../home-assistant/home-assistant.service";
import { formatHomeAssistantError } from "../../home-assistant/home-assistant.errors";
import {
  clampHomeAssistantSearchLimit,
  homeAssistantSearchMatches,
  tokenizeHomeAssistantSearchQuery,
} from "./home-assistant-search-utils";

function compactDevice(device: HomeAssistantDeviceSummary) {
  return {
    id: device.id,
    name: device.name,
    ...(device.areaId ? { areaId: device.areaId } : {}),
    ...(device.manufacturer ? { manufacturer: device.manufacturer } : {}),
    ...(device.model ? { model: device.model } : {}),
  };
}

export function createSearchHomeAssistantDevicesTool(
  homeAssistantService: HomeAssistantService,
  userId: string,
) {
  return (tool as any)(
    async (input: { instanceId: string; query: string; areaId?: string; limit?: number }) => {
      try {
        const limit = clampHomeAssistantSearchLimit(input.limit);
        const tokens = tokenizeHomeAssistantSearchQuery(input.query);
        const devices = await homeAssistantService.getDevices(userId, input.instanceId);
        const matches = devices.filter((device) => {
          if (input.areaId && device.areaId !== input.areaId) return false;
          return homeAssistantSearchMatches(
            [device.name, device.id, device.areaId, device.manufacturer, device.model],
            tokens,
          );
        });
        const result = matches.slice(0, limit).map(compactDevice);
        return JSON.stringify({
          query: input.query,
          totalMatches: matches.length,
          returned: result.length,
          truncated: matches.length > result.length,
          devices: result,
        });
      } catch (err) {
        return `Home Assistant error: ${formatHomeAssistantError(err).message}`;
      }
    },
    {
      name: "search_home_assistant_devices",
      description:
        "Searches Home Assistant devices by a short target phrase and returns compact, capped results. Use this to find a device id before searching entities by deviceId.",
      schema: z.object({
        instanceId: z
          .string()
          .describe("The Home Assistant instance ID from list_home_assistant_instances"),
        query: z
          .string()
          .min(1)
          .describe("Short target phrase, such as 'living room lamp' or 'thermostat'"),
        areaId: z.string().optional().describe("Optional Home Assistant area_id filter"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe("Maximum results to return, default 10, max 25"),
      }),
    },
  );
}
