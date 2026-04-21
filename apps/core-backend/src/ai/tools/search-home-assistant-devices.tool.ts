import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { HomeAssistantDeviceSummary } from "@slate/shared";
import type { HomeAssistantService } from "../../home-assistant/home-assistant.service";
import { formatHomeAssistantError } from "../../home-assistant/home-assistant.errors";
import {
  clampHomeAssistantSearchLimit,
  homeAssistantSearchMatches,
  rankBySearchTokens,
  tokenizeHomeAssistantSearchQuery,
} from "./home-assistant-search-utils";
import { unwrapLangChainToolCallInput } from "./langchain-tool-input";
import { homeAssistantInstanceOrErrorJson } from "./home-assistant-instance-guard";

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
    async (input: {
      instanceId: string;
      query: string;
      areaId: string | null | undefined;
      limit: number | null | undefined;
    }) => {
      try {
        const guard = await homeAssistantInstanceOrErrorJson(
          homeAssistantService,
          userId,
          input.instanceId,
        );
        if (!guard.ok) {
          return guard.body;
        }

        const areaId = input.areaId ?? null;
        const limit = clampHomeAssistantSearchLimit(input.limit);
        const tokens = tokenizeHomeAssistantSearchQuery(input.query);

        const [devices, areas] = await Promise.all([
          homeAssistantService.getDevices(userId, input.instanceId),
          homeAssistantService.getAreas(userId, input.instanceId).catch(() => []),
        ]);
        const areaNameById = new Map(areas.map((a) => [a.id, a.name] as const));

        const buildParts = (device: HomeAssistantDeviceSummary) => {
          const areaName = device.areaId ? areaNameById.get(device.areaId) : undefined;
          return [
            device.name,
            device.id,
            device.areaId,
            areaName,
            device.manufacturer,
            device.model,
          ];
        };

        const filtered = devices.filter((device) => {
          if (areaId && device.areaId !== areaId) return false;
          return true;
        });

        const strictMatches = filtered.filter((device) =>
          homeAssistantSearchMatches(buildParts(device), tokens),
        );
        const ordered =
          tokens.length === 0
            ? filtered
            : strictMatches.length > 0
              ? strictMatches
              : rankBySearchTokens(filtered, tokens, buildParts);
        const relaxedFallback =
          tokens.length > 0 && strictMatches.length === 0 && ordered.length > 0;

        const result = ordered.slice(0, limit).map(compactDevice);
        return JSON.stringify({
          query: input.query,
          totalMatches: ordered.length,
          returned: result.length,
          truncated: ordered.length > result.length,
          relaxedFallback,
          devices: result,
        });
      } catch (err) {
        return `Home Assistant error: ${formatHomeAssistantError(err).message}`;
      }
    },
    {
      name: "search_home_assistant_devices",
      description:
        "Searches Home Assistant devices by a short phrase; use list_home_assistant_instances for instanceId. Matching is case-insensitive and typo-tolerant on words (e.g. thermost for thermostat). Area names are matched. Use the returned device id with list_home_assistant_device_entities to see all sensors/readings for that hardware, or search_home_assistant_entities with deviceId to filter.",
      schema: z.preprocess(
        unwrapLangChainToolCallInput,
        z.object({
          instanceId: z
            .string()
            .describe(
              "Exact id from list_home_assistant_instances. Never use default or other placeholders.",
            ),
          query: z
            .string()
            .min(1)
            .describe("Short target phrase, such as 'living room lamp' or 'thermostat'"),
          areaId: z
            .string()
            .nullish()
            .describe("Optional Home Assistant area_id filter; omit or null if unused"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(25)
            .nullish()
            .describe("Maximum results to return, default 10, max 25; omit or null for default"),
        }),
      ),
    },
  );
}
