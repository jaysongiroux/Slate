/** Matches notes sidebar heading icon buttons (Tailwind; old .sidebar-heading__button CSS was removed). */
export const chatHeadingIconBtnClass =
  "inline-flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-faint transition-colors hover:bg-white/[0.08] hover:text-foreground";

export const AI_NOTE_STREAM_EVENT = "slate-ai-note-stream";

export type AiNoteStreamDetail = {
  documentId: string;
  kind: "create" | "edit";
  phase: "start" | "delta" | "done";
  content: string;
};

export const CHAT_COMPOSER_MAX_LINES = 4;

/** Map raw provider + model config to a clean display label. */
export function getChatModelDisplayName(provider?: string, model?: string): string {
  const m = model?.trim() ?? "";
  if (!m) return "";

  const KNOWN: Record<string, string> = {
    "claude-sonnet-4-20250514": "Claude Sonnet",
    "claude-haiku-4-5-20251001": "Claude Haiku",
    "claude-opus-4-20250514": "Claude Opus",
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o Mini",
    "gpt-4-turbo": "GPT-4 Turbo",
    "o3-mini": "o3 Mini",
  };

  if (KNOWN[m]) return KNOWN[m];

  // Pattern-based fallbacks for Anthropic models: "claude-sonnet-4-xxx" → "Claude Sonnet"
  const claudeMatch = m.match(/^claude-(\w+)/);
  if (claudeMatch) {
    return `Claude ${claudeMatch[1].charAt(0).toUpperCase()}${claudeMatch[1].slice(1)}`;
  }

  // GPT pattern: "gpt-5" → "GPT-5"
  if (m.startsWith("gpt-")) {
    return m
      .replace("gpt-", "GPT-")
      .replace(/-/g, " ")
      .replace(/ (\w)/g, (_, c) => ` ${c.toUpperCase()}`);
  }

  // o-series pattern: "o4-mini" → "o4 Mini"
  if (/^o\d/.test(m)) {
    return m.replace(/-/g, " ").replace(/ (\w)/g, (_, c) => ` ${c.toUpperCase()}`);
  }

  // Pass through raw model string for Ollama / OpenAI-compatible / unknown
  return m;
}

/** Markdown link label must not contain `]` (see ChatMessage NOTE_LINK_RE). */
export function safeNoteLinkTitle(title: string): string {
  return title.replace(/\]/g, "");
}

export interface MessageItem {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  metadata?: ChatMessageMetadata | null;
}

/**
 * Extra fields the backend persists alongside a message. `kind: "error"` rows are
 * failed turns; they render as an error notice and are never replayed to the model.
 */
export interface ChatMessageMetadata {
  kind?: string;
  toolName?: string;
  code?: string;
  title?: string;
  detail?: string;
  actionUrl?: string;
  retryable?: boolean;
}

export interface ComposerNoteRef {
  documentId: string;
  title: string;
}

export interface ComposerCalendarRef {
  subscriptionId: string;
  name: string;
  source: "provider" | "ics";
}
