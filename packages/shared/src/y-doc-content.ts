import type * as Y from "yjs";
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror";

export function extractTiptapContentFromYDoc(ydoc: Y.Doc, fragmentName = "prosemirror"): any[] {
  const fragment = ydoc.getXmlFragment(fragmentName);
  const rawJson = yXmlFragmentToProsemirrorJSON(fragment);
  const content = rawJson?.content;
  return Array.isArray(content) ? content : [];
}
