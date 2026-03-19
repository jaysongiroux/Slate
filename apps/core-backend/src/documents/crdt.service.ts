import { Injectable } from "@nestjs/common";
import * as Y from "yjs";
import {
  prosemirrorJSONToYDoc,
  yXmlFragmentToProsemirrorJSON,
} from "y-prosemirror";
import { Node as PmNode } from "prosemirror-model";
import {
  slateSchema,
  slateMarkdownSerializer,
  slateMarkdownParser,
} from "@slate/shared";

const FRAGMENT_NAME = "prosemirror";

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
      const emptyDoc = slateSchema.topNodeType.create(null, [
        slateSchema.nodes.paragraph.create(),
      ]);
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
  ): { mergedState: Buffer; markdown: string; plainText: string } {
    const ydoc = new Y.Doc();
    if (existingState && existingState.length > 0) {
      Y.applyUpdate(ydoc, existingState);
    }
    Y.applyUpdate(ydoc, incomingUpdate);
    const mergedState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
    const materialized = this.materialize(mergedState);
    return {
      mergedState,
      markdown: materialized.markdown,
      plainText: materialized.plainText,
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
    const json = yXmlFragmentToProsemirrorJSON(fragment);
    const pmNode = PmNode.fromJSON(slateSchema, json);
    const markdown = slateMarkdownSerializer.serialize(pmNode);
    const plainText = pmNode.textBetween(0, pmNode.content.size, "\n", "");
    return { markdown, plainText };
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
