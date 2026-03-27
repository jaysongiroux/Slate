import * as Y from "yjs";

export class YDocManager {
  constructor({ metadataStore }) {
    this.metadataStore = metadataStore;
    this.docs = new Map(); // noteId -> Y.Doc
  }

  getDoc(noteId) {
    if (this.docs.has(noteId)) return this.docs.get(noteId);

    const doc = new Y.Doc();
    const crdtState = this.metadataStore.getCrdtState(noteId);
    if (crdtState) {
      Y.applyUpdate(doc, new Uint8Array(crdtState));
    }
    this.docs.set(noteId, doc);
    return doc;
  }

  async bootstrapFromMarkdown(noteId, markdown) {
    const doc = new Y.Doc();

    if (markdown.trim()) {
      const { slateMarkdownParser, slateSchema } = await import("@slate/shared");
      const { prosemirrorJSONToYDoc } = await import("y-prosemirror");

      const pmDoc = slateMarkdownParser.parse(markdown);
      if (pmDoc) {
        const tempDoc = prosemirrorJSONToYDoc(slateSchema, pmDoc.toJSON(), "prosemirror");
        const update = Y.encodeStateAsUpdate(tempDoc);
        Y.applyUpdate(doc, update);
        tempDoc.destroy();
      }
    } else {
      doc.getXmlFragment("prosemirror");
    }

    this.docs.set(noteId, doc);
    this.persist(noteId);
    return doc;
  }

  /**
   * Replace the content of an existing Y.Doc from new markdown without
   * creating new client IDs.  Deleting existing items first creates proper
   * tombstones that propagate to the server, preventing merge-duplication
   * that happens when a re-bootstrapped doc (new client IDs) is merged with
   * the server's old state.
   */
  async replaceFromMarkdown(noteId, markdown) {
    const doc = this.getDoc(noteId);
    const fragment = doc.getXmlFragment("prosemirror");

    // Step 1 — delete existing content (creates tombstones with existing client IDs)
    doc.transact(() => {
      while (fragment.length > 0) fragment.delete(0, 1);
    });

    // Step 2 — insert new content
    if (markdown.trim()) {
      const { slateMarkdownParser, slateSchema } = await import("@slate/shared");
      const { prosemirrorJSONToYDoc } = await import("y-prosemirror");

      const pmDoc = slateMarkdownParser.parse(markdown);
      if (pmDoc) {
        const tempDoc = prosemirrorJSONToYDoc(slateSchema, pmDoc.toJSON(), "prosemirror");
        const update = Y.encodeStateAsUpdate(tempDoc);
        Y.applyUpdate(doc, update);
        tempDoc.destroy();
      }
    }

    this.persist(noteId);
  }

  applyUpdate(noteId, update) {
    const doc = this.getDoc(noteId);
    Y.applyUpdate(doc, new Uint8Array(update));
    this.persist(noteId);
  }

  getUpdate(noteId, remoteStateVector) {
    const doc = this.getDoc(noteId);
    if (remoteStateVector) {
      return Buffer.from(Y.encodeStateAsUpdate(doc, new Uint8Array(remoteStateVector)));
    }
    return Buffer.from(Y.encodeStateAsUpdate(doc));
  }

  getStateVector(noteId) {
    const doc = this.getDoc(noteId);
    return Buffer.from(Y.encodeStateVector(doc));
  }

  getFullState(noteId) {
    const doc = this.getDoc(noteId);
    return Buffer.from(Y.encodeStateAsUpdate(doc));
  }

  persist(noteId) {
    const doc = this.docs.get(noteId);
    if (!doc) return;
    this.metadataStore.setCrdtState(noteId, Buffer.from(Y.encodeStateAsUpdate(doc)));
    this.metadataStore.setStateVector(noteId, Buffer.from(Y.encodeStateVector(doc)));
  }

  replaceImageSrc(noteId, oldSrc, newSrc) {
    const doc = this.getDoc(noteId);
    const fragment = doc.getXmlFragment("prosemirror");
    this._walkAndReplaceSrc(fragment, oldSrc, newSrc);
    this.persist(noteId);
  }

  _walkAndReplaceSrc(node, oldSrc, newSrc) {
    for (let i = 0; i < node.length; i++) {
      const child = node.get(i);
      if (child instanceof Y.XmlElement) {
        if ((child.nodeName === "image" || child.nodeName === "img") && child.getAttribute("src") === oldSrc) {
          child.setAttribute("src", newSrc);
        }
        this._walkAndReplaceSrc(child, oldSrc, newSrc);
      }
    }
  }

  async materializeMarkdown(noteId) {
    const doc = this.getDoc(noteId);
    const fragment = doc.getXmlFragment("prosemirror");
    const { yXmlFragmentToProsemirrorJSON } = await import("y-prosemirror");
    const { slateSchema, slateMarkdownSerializer } = await import("@slate/shared");
    const { Node: PmNode } = await import("prosemirror-model");

    try {
      const json = yXmlFragmentToProsemirrorJSON(fragment);
      const pmDoc = PmNode.fromJSON(slateSchema, json);
      return slateMarkdownSerializer.serialize(pmDoc);
    } catch {
      return "";
    }
  }

  hasCrdtState(noteId) {
    return this.metadataStore.getCrdtState(noteId) !== null;
  }

  release(noteId) {
    const doc = this.docs.get(noteId);
    if (doc) { doc.destroy(); this.docs.delete(noteId); }
  }
}
