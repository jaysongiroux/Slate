import type { HomeAssistantService } from "../../home-assistant/home-assistant.service";

/**
 * Ensures `instanceId` is a real configured instance. Models often invent
 * placeholders like "default" which would otherwise fail deep in HA calls.
 */
export async function homeAssistantInstanceOrErrorJson(
  homeAssistantService: HomeAssistantService,
  userId: string,
  instanceId: string,
): Promise<{ ok: true } | { ok: false; body: string }> {
  const instances = await homeAssistantService.listInstances(userId);
  if (instances.some((i) => i.id === instanceId)) {
    return { ok: true };
  }
  return {
    ok: false,
    body: JSON.stringify({
      error: "unknown_instance_id",
      message:
        "Call list_home_assistant_instances first and pass an id from that response. Never use placeholders such as default, primary, or home.",
      validInstances: instances.map((i) => ({ id: i.id, name: i.name })),
    }),
  };
}
