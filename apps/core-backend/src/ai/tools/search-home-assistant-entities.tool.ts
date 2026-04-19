import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { HomeAssistantEntitySummary } from "@slate/shared";
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

function compactEntity(entity: HomeAssistantEntitySummary) {
  return {
    entityId: entity.entityId,
    name: entity.name,
    domain: entity.domain,
    ...(entity.areaId ? { areaId: entity.areaId } : {}),
    ...(entity.deviceId ? { deviceId: entity.deviceId } : {}),
    state: entity.state?.state ?? "unknown",
    supportedControls: entity.supportedControls,
  };
}

export function createSearchHomeAssistantEntitiesTool(
  homeAssistantService: HomeAssistantService,
  userId: string,
) {
  return (tool as any)(
    async (input: {
      instanceId: string;
      query: string;
      domain: string | null | undefined;
      areaId: string | null | undefined;
      deviceId: string | null | undefined;
      controllableOnly: boolean | null | undefined;
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

        const domain = input.domain ?? null;
        const areaId = input.areaId ?? null;
        const deviceId = input.deviceId ?? null;
        const controllableOnly = input.controllableOnly ?? null;
        const limit = clampHomeAssistantSearchLimit(input.limit);
        const tokens = tokenizeHomeAssistantSearchQuery(input.query);

        const [entities, areas, devices] = await Promise.all([
          homeAssistantService.getEntities(userId, input.instanceId),
          homeAssistantService.getAreas(userId, input.instanceId).catch(() => []),
          homeAssistantService.getDevices(userId, input.instanceId).catch(() => []),
        ]);

        const areaNameById = new Map(areas.map((a) => [a.id, a.name] as const));
        const deviceNameById = new Map(devices.map((d) => [d.id, d.name] as const));

        const buildParts = (entity: HomeAssistantEntitySummary) => {
          const areaName = entity.areaId ? areaNameById.get(entity.areaId) : undefined;
          const deviceName = entity.deviceId ? deviceNameById.get(entity.deviceId) : undefined;
          return [
            entity.name,
            entity.entityId,
            entity.domain,
            entity.areaId,
            areaName,
            entity.deviceId,
            deviceName,
            entity.state?.state,
            entity.supportedControls.join(" "),
          ];
        };

        const filtered = entities.filter((entity) => {
          if (domain && entity.domain !== domain) return false;
          if (areaId && entity.areaId !== areaId) return false;
          if (deviceId && entity.deviceId !== deviceId) return false;
          if (controllableOnly && entity.supportedControls.length === 0) return false;
          return true;
        });

        const strictMatches = filtered.filter((entity) =>
          homeAssistantSearchMatches(buildParts(entity), tokens),
        );
        const ordered =
          tokens.length === 0
            ? filtered
            : strictMatches.length > 0
              ? strictMatches
              : rankBySearchTokens(filtered, tokens, buildParts);
        const relaxedFallback =
          tokens.length > 0 && strictMatches.length === 0 && ordered.length > 0;

        const result = ordered.slice(0, limit).map(compactEntity);
        return JSON.stringify({
          query: input.query,
          totalMatches: ordered.length,
          returned: result.length,
          truncated: ordered.length > result.length,
          relaxedFallback,
          entities: result,
        });
      } catch (err) {
        return `Home Assistant error: ${formatHomeAssistantError(err).message}`;
      }
    },
    {
      name: "search_home_assistant_entities",
      description:
        "Searches Home Assistant entities by a short target phrase and returns compact, capped results. Use list_home_assistant_instances first to obtain instanceId (never guess default or primary). Matching is case-insensitive and typo-tolerant on words. Prefer short phrases like 'corner lamp' or 'living room'; area and device names are matched automatically. If no strict match, best overlapping tokens are returned. Use before control when entity_id is unknown.",
      schema: z.preprocess(
        unwrapLangChainToolCallInput,
        z.object({
          instanceId: z
            .string()
            .describe(
              "Exact id from list_home_assistant_instances (required). Never use default, primary, or other placeholders.",
            ),
          query: z
            .string()
            .min(1)
            .describe("Short target phrase, such as 'living room lights' or 'kitchen switch'"),
          domain: z
            .string()
            .nullish()
            .describe(
              "Optional entity domain filter, such as light, switch, climate, scene, or script; omit or null if unused",
            ),
          areaId: z
            .string()
            .nullish()
            .describe("Optional Home Assistant area_id filter; omit or null if unused"),
          deviceId: z
            .string()
            .nullish()
            .describe("Optional Home Assistant device id filter; omit or null if unused"),
          controllableOnly: z
            .boolean()
            .nullish()
            .describe(
              "When true, only return entities Slate can safely control; omit or null if unused",
            ),
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
