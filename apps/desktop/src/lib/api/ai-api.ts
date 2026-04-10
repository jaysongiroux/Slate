import type { SendMessageEvent, UpdateAiConfigRequest } from "./ipc-core";
import { desktopApi } from "./ipc-core";

export function getLastActiveChatConversationId() {
  return desktopApi().getLastActiveChatConversationId();
}

export function setLastActiveChatConversationId(conversationId: string | null) {
  return desktopApi().setLastActiveChatConversationId(conversationId);
}

export function getAiConfig() {
  return desktopApi().getAiConfig();
}

export function updateAiConfig(config: UpdateAiConfigRequest) {
  return desktopApi().updateAiConfig(config);
}

export function createConversation() {
  return desktopApi().createConversation();
}

export function listConversations() {
  return desktopApi().listConversations();
}

export function deleteConversation(id: string) {
  return desktopApi().deleteConversation(id);
}

export function getConversationMessages(conversationId: string) {
  return desktopApi().getConversationMessages(conversationId);
}

export function sendMessage(
  conversationId: string,
  content: string,
  onEvent: (event: SendMessageEvent) => void,
  enabledCalendarIds?: string[],
  enabledIcsIds?: string[],
  timezone?: string,
) {
  return desktopApi().sendMessage(
    conversationId,
    content,
    onEvent,
    enabledCalendarIds,
    enabledIcsIds,
    timezone,
  );
}

export function cancelSendMessage() {
  return desktopApi().cancelSendMessage();
}

export function triggerEmbedding() {
  return desktopApi().triggerEmbedding();
}
