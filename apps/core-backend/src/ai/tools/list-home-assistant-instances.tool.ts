import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { HomeAssistantService } from "../../home-assistant/home-assistant.service";
import { formatHomeAssistantError } from "../../home-assistant/home-assistant.errors";

export function createListHomeAssistantInstancesTool(
  homeAssistantService: HomeAssistantService,
  userId: string,
) {
  return (tool as any)(
    async () => {
      try {
        const instances = await homeAssistantService.listInstances(userId);
        return JSON.stringify(instances);
      } catch (err) {
        return `Home Assistant error: ${formatHomeAssistantError(err).message}`;
      }
    },
    {
      name: "list_home_assistant_instances",
      description:
        "Lists the user's configured Home Assistant instances with id and name. Call this first before any other Home Assistant tool; use the id field as instanceId everywhere else (required—do not guess default or primary).",
      schema: z.object({}),
    },
  );
}
