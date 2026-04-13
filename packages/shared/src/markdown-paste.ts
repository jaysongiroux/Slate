import { slateMarkdownParser } from "./markdown-parser";
import { toTiptapJson } from "./tiptap-ydoc";

function normalizeLooseTaskListMarkdown(text: string): string {
  const lines = text.split("\n");
  const normalized: string[] = [];
  let activeFence: string | null = null;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      activeFence = activeFence === marker ? null : marker;
      normalized.push(line);
      continue;
    }

    if (activeFence) {
      normalized.push(line);
      continue;
    }

    const looseTaskMatch = line.match(/^(\s*)\[([ xX])\](.*)$/);
    if (looseTaskMatch) {
      const [, indent, checked, rest] = looseTaskMatch;
      normalized.push(`${indent}- [${checked}]${rest}`);
      continue;
    }

    normalized.push(line);
  }

  return normalized.join("\n");
}

export function parseMarkdownForTiptapPaste(text: string): any[] {
  const normalizedText = normalizeLooseTaskListMarkdown(text);
  const parsed = slateMarkdownParser.parse(normalizedText);
  const tiptapJson = parsed ? toTiptapJson(parsed.toJSON()) : null;
  const content = tiptapJson?.content;
  return Array.isArray(content) ? content : [];
}
