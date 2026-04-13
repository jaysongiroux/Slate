/** Matches user-visible note and calendar references in chat (see ChatMessage). */
export const CHAT_LINK_MD_RE = /\[([^\]]+)\]\((note|calendar):\/\/([^)]+)\)/g;

export type NoteLinkMarkdownPart =
  | { kind: "text"; value: string }
  | { kind: "chip"; title: string; documentId: string }
  | { kind: "calendar_chip"; title: string; subscriptionId: string };

export function parseNoteLinkMarkdown(content: string): NoteLinkMarkdownPart[] {
  const parts: NoteLinkMarkdownPart[] = [];
  let lastIndex = 0;
  CHAT_LINK_MD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CHAT_LINK_MD_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ kind: "text", value: content.slice(lastIndex, match.index) });
    }
    if (match[2] === "calendar") {
      parts.push({ kind: "calendar_chip", title: match[1], subscriptionId: match[3] });
    } else {
      parts.push({ kind: "chip", title: match[1], documentId: match[3] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push({ kind: "text", value: content.slice(lastIndex) });
  }
  return parts;
}
