/** Matches user-visible note references in chat (see ChatMessage). */
export const NOTE_LINK_MD_RE = /\[([^\]]+)\]\(note:\/\/([^)]+)\)/g;

export type NoteLinkMarkdownPart =
  | { kind: "text"; value: string }
  | { kind: "chip"; title: string; documentId: string };

export function parseNoteLinkMarkdown(content: string): NoteLinkMarkdownPart[] {
  const parts: NoteLinkMarkdownPart[] = [];
  let lastIndex = 0;
  NOTE_LINK_MD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NOTE_LINK_MD_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ kind: "text", value: content.slice(lastIndex, match.index) });
    }
    parts.push({ kind: "chip", title: match[1], documentId: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push({ kind: "text", value: content.slice(lastIndex) });
  }
  return parts;
}
