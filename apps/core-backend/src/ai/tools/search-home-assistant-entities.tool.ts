import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { HomeAssistantEntitySummary } from "@slate/shared";
import type { HomeAssistantService } from "../../home-assistant/home-assistant.service";
import { formatHomeAssistantError } from "../../home-assistant/home-assistant.errors";
import {
  clampHomeAssistantSearchLimit,
  homeAssistantSearchMatches,
  tokenizeHomeAssistantSearchQuery,
} from "./home-assistant-search-utils";

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
      domain?: string;
      areaId?: string;
      deviceId?: string;
      controllableOnly?: boolean;
      limit?: number;
    }) => {
      try {
        const limit = clampHomeAssistantSearchLimit(input.limit);
        const tokens = tokenizeHomeAssistantSearchQuery(input.query);
        const entities = await homeAssistantService.getEntities(userId, input.instanceId);
        const matches = entities.filter((entity) => {
          if (input.domain && entity.domain !== input.domain) return false;
          if (input.areaId && entity.areaId !== input.areaId) return false;
          if (input.deviceId && entity.deviceId !== input.deviceId) return false;
          if (input.controllableOnly && entity.supportedControls.length === 0) return false;
          return homeAssistantSearchMatches(
            [
              entity.name,
              entity.entityId,
              entity.domain,
              entity.areaId,
              entity.deviceId,
              entity.state?.state,
              entity.supportedControls.join(" "),
            ],
            tokens,
          );
        });
        const result = matches.slice(0, limit).map(compactEntity);
        return JSON.stringify({
          query: input.query,
          totalMatches: matches.length,
          returned: result.length,
          truncated: matches.length > result.length,
          entities: result,
        });
      } catch (err) {
        return `Home Assistant error: ${formatHomeAssistantError(err).message}`;
      }
    },
    {
      name: "search_home_assistant_entities",
      description:
        "Searches Home Assistant entities by a short target phrase and returns compact, capped results. Use this before controlling entities when the exact entity_id is unclear. Prefer target words like 'living room lights', not the action words.",
      schema: z.object({
        instanceId: z
          .string()
          .describe("The Home Assistant instance ID from list_home_assistant_instances"),
        query: z
          .string()
          .min(1)
          .describe("Short target phrase, such as 'living room lights' or 'kitchen switch'"),
        domain: z
          .string()
          .optional()
          .describe(
            "Optional entity domain filter, such as light, switch, climate, scene, or script",
          ),
        areaId: z.string().optional().describe("Optional Home Assistant area_id filter"),
        deviceId: z.string().optional().describe("Optional Home Assistant device id filter"),
        controllableOnly: z
          .boolean()
          .optional()
          .describe("When true, only return entities Slate can safely control"),
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
