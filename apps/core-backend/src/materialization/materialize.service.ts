import { noteContentToMarkdown } from "@slate/shared";

export class MaterializeService {
  toMarkdown(content: unknown): string | null {
    // Legacy Markdown-only notes do not have an editor document. An actual
    // empty editor document, on the other hand, is a valid edit to blank.
    if (!content || typeof content !== "object" || !("type" in content) || content.type !== "doc") {
      return null;
    }
    return noteContentToMarkdown(content as Record<string, unknown>);
  }
}
