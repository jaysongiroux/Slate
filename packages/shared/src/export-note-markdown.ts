import { Node } from "prosemirror-model";
import { expandTableOfContentsInDocJson } from "./export-expand-toc";
import { slateMarkdownSerializer } from "./markdown-serializer";
import { slateSchema } from "./schema";
import { tiptapDocJsonToSlateDocJson } from "./tiptap-to-slate-json";

export interface NoteContentMarkdownOptions {
  tightLists?: boolean;
}

/**
 * Serializes stored TipTap document JSON to markdown using the shared Slate
 * schema and serializer. Expands `tableOfContents` to static lists first.
 */
export function noteContentToMarkdown(
  content: Record<string, unknown>,
  options: NoteContentMarkdownOptions = {},
): string {
  const expanded = expandTableOfContentsInDocJson(content);
  const slateJson = tiptapDocJsonToSlateDocJson(expanded);
  const doc = Node.fromJSON(slateSchema, slateJson);
  return slateMarkdownSerializer
    .serialize(doc, options.tightLists ? { tightLists: true } : undefined)
    .trimEnd();
}
