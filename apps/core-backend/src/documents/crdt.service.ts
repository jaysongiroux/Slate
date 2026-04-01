import { Injectable } from "@nestjs/common";
import * as Y from "yjs";
import {
  prosemirrorJSONToYDoc,
  prosemirrorJSONToYXmlFragment,
  yXmlFragmentToProsemirrorJSON,
} from "y-prosemirror";
import { Node as PmNode } from "prosemirror-model";
import { slateSchema, slateMarkdownSerializer, slateMarkdownParser } from "@slate/shared";

const FRAGMENT_NAME = "prosemirror";

/**
 * Milkdown uses different mark type names than our shared ProseMirror schema.
 * Remap them so PmNode.fromJSON() succeeds.
 */
const MARK_NAME_MAP: Record<string, string> = {
  emphasis: "em",
  inlineCode: "code_inline",
  strike_through: "strikethrough",
};

function remapMarkNames(json: any): any {
  if (json == null || typeof json !== "object") return json;
  if (Array.isArray(json)) return json.map(remapMarkNames);

  const out: any = { ...json };

  // Remap mark type names
  if (out.type && MARK_NAME_MAP[out.type]) {
    out.type = MARK_NAME_MAP[out.type];
  }

  if (out.marks) {
    out.marks = out.marks.map(remapMarkNames);
  }
  if (out.content) {
    out.content = out.content.map(remapMarkNames);
  }

  return out;
}

@Injectable()
export class CrdtService {
  bootstrapFromMarkdown(markdown: string): {
    crdtState: Buffer;
    markdown: string;
    plainText: string;
  } {
    const pmNode = slateMarkdownParser.parse(markdown);
    if (!pmNode) {
      // Empty / unparseable markdown: create a minimal empty doc
      const emptyDoc = slateSchema.topNodeType.create(null, [slateSchema.nodes.paragraph.create()]);
      const ydoc = prosemirrorJSONToYDoc(slateSchema, emptyDoc.toJSON(), FRAGMENT_NAME);
      const crdtState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
      const materialized = this.materialize(crdtState);
      return {
        crdtState,
        markdown: materialized.markdown,
        plainText: materialized.plainText,
      };
    }

    const ydoc = prosemirrorJSONToYDoc(slateSchema, pmNode.toJSON(), FRAGMENT_NAME);
    const crdtState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
    const materialized = this.materialize(crdtState);
    return {
      crdtState,
      markdown: materialized.markdown,
      plainText: materialized.plainText,
    };
  }

  mergeUpdate(
    existingState: Buffer | null,
    incomingUpdate: Buffer,
  ): { mergedState: Buffer; markdown: string; plainText: string; contentChanged: boolean } {
    const ydoc = new Y.Doc();
    if (existingState && existingState.length > 0) {
      Y.applyUpdate(ydoc, existingState);
    }

    const svBefore = Buffer.from(Y.encodeStateVector(ydoc));
    Y.applyUpdate(ydoc, incomingUpdate);
    const svAfter = Buffer.from(Y.encodeStateVector(ydoc));

    const contentChanged = !svBefore.equals(svAfter);

    const mergedState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
    const materialized = this.materialize(mergedState);
    return {
      mergedState,
      markdown: materialized.markdown,
      plainText: materialized.plainText,
      contentChanged,
    };
  }

  computeDelta(serverState: Buffer, clientStateVector: Buffer): Buffer {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, serverState);
    return Buffer.from(Y.encodeStateAsUpdate(ydoc, clientStateVector));
  }

  materialize(crdtState: Buffer): { markdown: string; plainText: string } {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, crdtState);
    const fragment = ydoc.getXmlFragment(FRAGMENT_NAME);
    const rawJson = yXmlFragmentToProsemirrorJSON(fragment);
    const json = remapMarkNames(rawJson);
    const pmNode = PmNode.fromJSON(slateSchema, json);
    const markdown = slateMarkdownSerializer.serialize(pmNode);
    const plainText = pmNode.textBetween(0, pmNode.content.size, "\n", "");
    return { markdown, plainText };
  }

  replaceContent(
    ydoc: Y.Doc,
    markdown: string,
  ): {
    update: Buffer;
    markdown: string;
    plainText: string;
  } {
    const stateVectorBefore = Y.encodeStateVector(ydoc);

    const pmNode = slateMarkdownParser.parse(markdown);
    const json = pmNode ? pmNode.toJSON() : { type: "doc", content: [{ type: "paragraph" }] };

    ydoc.transact(() => {
      const fragment = ydoc.getXmlFragment(FRAGMENT_NAME);
      // Clear existing content
      while (fragment.length > 0) {
        fragment.delete(0, 1);
      }
      // Re-populate the same fragment from the parsed markdown.
      // prosemirrorJSONToYXmlFragment(schema, json, fragment) populates
      // the given fragment in-place, keeping the same Y.Doc instance.
      prosemirrorJSONToYXmlFragment(slateSchema, json, fragment);
    });

    const update = Buffer.from(Y.encodeStateAsUpdate(ydoc, stateVectorBefore));
    const fullState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
    const materialized = this.materialize(fullState);
    return {
      update,
      markdown: materialized.markdown,
      plainText: materialized.plainText,
    };
  }

  replaceImageSrc(
    crdtState: Buffer,
    oldSrc: string,
    newSrc: string,
  ): { crdtState: Buffer; markdown: string; plainText: string } {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, crdtState);
    const fragment = ydoc.getXmlFragment(FRAGMENT_NAME);

    ydoc.transact(() => {
      this.walkAndReplaceImageSrc(fragment, oldSrc, newSrc);
    });

    const updatedState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
    const materialized = this.materialize(updatedState);
    return {
      crdtState: updatedState,
      markdown: materialized.markdown,
      plainText: materialized.plainText,
    };
  }

  private walkAndReplaceImageSrc(
    element: Y.XmlFragment | Y.XmlElement,
    oldSrc: string,
    newSrc: string,
  ): void {
    for (let i = 0; i < element.length; i++) {
      const child = element.get(i);
      if (child instanceof Y.XmlElement) {
        if (child.nodeName === "image") {
          const src = child.getAttribute("src");
          if (src === oldSrc) {
            child.setAttribute("src", newSrc);
          }
        }
        this.walkAndReplaceImageSrc(child, oldSrc, newSrc);
      }
    }
  }
}
