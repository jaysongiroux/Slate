import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { HomeAssistantControlKind } from "@slate/shared";
import type { HomeAssistantService } from "../../home-assistant/home-assistant.service";
import { formatHomeAssistantError } from "../../home-assistant/home-assistant.errors";

const safeHomeAssistantControlSchema = z.enum([
  "turn_on",
  "turn_off",
  "toggle",
  "light_brightness",
  "light_color",
  "climate_temperature",
  "scene_run",
  "script_run",
]);

export function createControlHomeAssistantEntityTool(
  homeAssistantService: HomeAssistantService,
  userId: string,
) {
  return (tool as any)(
    async (input: {
      instanceId: string;
      entityId: string;
      control: HomeAssistantControlKind;
      value?: unknown;
    }) => {
      try {
        const result = await homeAssistantService.control(userId, input.instanceId, {
          entityId: input.entityId,
          control: input.control,
          value: input.value,
        });
        return JSON.stringify(result);
      } catch (err) {
        return `Home Assistant error: ${formatHomeAssistantError(err).message}`;
      }
    },
    {
      name: "control_home_assistant_entity",
      description:
        "Safely controls a Home Assistant entity through Slate. Only supports Slate's safe starter controls: on, off, toggle, light brightness/color, climate target temperature, and running scenes/scripts.",
      schema: z.object({
        instanceId: z.string().describe("The Home Assistant instance ID"),
        entityId: z.string().describe("The Home Assistant entity_id to control"),
        control: safeHomeAssistantControlSchema.describe("The safe control to apply"),
        value: z
          .unknown()
          .optional()
          .describe(
            "Control value when required, such as brightness 0-100, RGB array, or temperature",
          ),
      }),
    },
  );
}
