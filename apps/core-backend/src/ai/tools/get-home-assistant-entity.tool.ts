import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { HomeAssistantService } from "../../home-assistant/home-assistant.service";
import { formatHomeAssistantError } from "../../home-assistant/home-assistant.errors";

export function createGetHomeAssistantEntityTool(
  homeAssistantService: HomeAssistantService,
  userId: string,
) {
  return (tool as any)(
    async ({ instanceId, entityId }: { instanceId: string; entityId: string }) => {
      try {
        const entity = await homeAssistantService.getEntity(userId, instanceId, entityId);
        return JSON.stringify(entity);
      } catch (err) {
        return `Home Assistant error: ${formatHomeAssistantError(err).message}`;
      }
    },
    {
      name: "get_home_assistant_entity",
      description:
        "Gets one Home Assistant entity by entity_id, including its current state and safe controls supported by Slate.",
      schema: z.object({
        instanceId: z.string().describe("The Home Assistant instance ID"),
        entityId: z.string().describe("The Home Assistant entity_id, for example light.kitchen"),
      }),
    },
  );
}
