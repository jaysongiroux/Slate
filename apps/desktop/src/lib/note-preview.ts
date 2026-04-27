/**
 * Build a short plain-text preview from a note's raw markdown.
 *
 * Strips frontmatter, headings, list markers, blockquotes, inline code,
 * link/image syntax, and bold/italic. Collapses whitespace to single spaces.
 * Truncates to `maxChars` with an ellipsis when needed. Returns "" when the
 * note body is empty.
 */
export function markdownPreview(markdown: string, maxChars = 240): string {
  if (!markdown) return "";
  const stripped = markdown
    .replace(/^---[\s\S]*?---\s*/m, "") // YAML frontmatter at top
    .replace(/^#{1,6}\s+.+$/m, "") // strip the first heading (usually the title)
    .replace(/^\s*[-*+]\s+/gm, "") // list markers
    .replace(/^\s*\d+\.\s+/gm, "") // numbered list markers
    .replace(/^\s*>\s+/gm, "") // blockquotes
    .replace(/```[\s\S]*?```/g, "") // fenced code blocks
    .replace(/`{1,3}([^`\n]*)`{1,3}/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → text
    .replace(/[*_]{1,3}([^*_\n]+)[*_]{1,3}/g, "$1") // bold/italic
    .replace(/\s+/g, " ")
    .trim();

  if (stripped.length <= maxChars) return stripped;
  return stripped.slice(0, maxChars).trimEnd() + "…";
}
