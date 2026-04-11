import { Node as ProsemirrorNode } from "prosemirror-model";
import { slateSchema, slateMarkdownSerializer, toTiptapJson } from "@slate/shared";

export class MaterializeService {
  /**
   * Convert ProseMirror JSON (Tiptap format) to markdown.
   * Uses the shared Slate schema and serializer.
   */
  toMarkdown(content: Record<string, unknown>): string {
    try {
      const normalized = toTiptapJson(content);
      const node = ProsemirrorNode.fromJSON(slateSchema, normalized);
      return slateMarkdownSerializer.serialize(node);
    } catch {
      return "";
    }
  }
}
