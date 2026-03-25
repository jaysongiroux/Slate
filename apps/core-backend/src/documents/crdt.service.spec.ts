import { CrdtService } from "./crdt.service";
import * as Y from "yjs";

describe("CrdtService", () => {
  let service: CrdtService;

  beforeEach(() => {
    service = new CrdtService();
  });

  describe("bootstrapFromMarkdown", () => {
    it("should bootstrap from heading + paragraph", () => {
      const md = "# Hello\n\nWorld";
      const result = service.bootstrapFromMarkdown(md);

      expect(result.crdtState).toBeInstanceOf(Buffer);
      expect(result.crdtState.length).toBeGreaterThan(0);
      expect(result.markdown).toContain("# Hello");
      expect(result.markdown).toContain("World");
      expect(result.plainText).toContain("Hello");
      expect(result.plainText).toContain("World");
    });

    it("should bootstrap from empty markdown", () => {
      const result = service.bootstrapFromMarkdown("");

      expect(result.crdtState).toBeInstanceOf(Buffer);
      expect(result.crdtState.length).toBeGreaterThan(0);
      // Empty doc should produce minimal markdown
      expect(typeof result.markdown).toBe("string");
      expect(typeof result.plainText).toBe("string");
    });

    it("should preserve image URLs", () => {
      const md = "![alt text](https://example.com/image.png)";
      const result = service.bootstrapFromMarkdown(md);

      expect(result.markdown).toContain("https://example.com/image.png");
    });
  });

  describe("mergeUpdate", () => {
    it("should merge into existing state", () => {
      const initial = service.bootstrapFromMarkdown("# First");

      // Create a second doc with a different update
      const secondDoc = new Y.Doc();
      const frag = secondDoc.getXmlFragment("prosemirror");
      secondDoc.transact(() => {
        const para = new Y.XmlElement("paragraph");
        const text = new Y.XmlText();
        text.insert(0, "Second");
        para.insert(0, [text]);
        frag.insert(frag.length, [para]);
      });
      const secondUpdate = Buffer.from(Y.encodeStateAsUpdate(secondDoc));

      const result = service.mergeUpdate(initial.crdtState, secondUpdate);

      expect(result.mergedState).toBeInstanceOf(Buffer);
      expect(result.mergedState.length).toBeGreaterThan(0);
      expect(result.markdown).toContain("First");
    });

    it("should create state from null", () => {
      const doc = new Y.Doc();
      const frag = doc.getXmlFragment("prosemirror");
      doc.transact(() => {
        const para = new Y.XmlElement("paragraph");
        const text = new Y.XmlText();
        text.insert(0, "Hello from null");
        para.insert(0, [text]);
        frag.insert(0, [para]);
      });
      const update = Buffer.from(Y.encodeStateAsUpdate(doc));

      const result = service.mergeUpdate(null, update);

      expect(result.mergedState).toBeInstanceOf(Buffer);
      expect(result.markdown).toContain("Hello from null");
    });
  });

  describe("computeDelta", () => {
    it("should return buffer for identical states", () => {
      const { crdtState } = service.bootstrapFromMarkdown("# Test");

      const doc = new Y.Doc();
      Y.applyUpdate(doc, crdtState);
      const stateVector = Buffer.from(Y.encodeStateVector(doc));

      const delta = service.computeDelta(crdtState, stateVector);

      expect(delta).toBeInstanceOf(Buffer);
      // Delta for identical states should be small (just header, no actual changes)
      expect(delta.length).toBeLessThan(crdtState.length);
    });
  });

  describe("materialize", () => {
    it("should extract markdown and plainText", () => {
      const { crdtState } = service.bootstrapFromMarkdown(
        "# Title\n\nSome paragraph text",
      );
      const result = service.materialize(crdtState);

      expect(result.markdown).toContain("# Title");
      expect(result.markdown).toContain("Some paragraph text");
      expect(result.plainText).toContain("Title");
      expect(result.plainText).toContain("Some paragraph text");
    });
  });

  describe("replaceImageSrc", () => {
    it("should replace pending URL with real URL", () => {
      const md = "![photo](pending://upload-123)";
      const { crdtState } = service.bootstrapFromMarkdown(md);

      const result = service.replaceImageSrc(
        crdtState,
        "pending://upload-123",
        "https://cdn.example.com/photo.jpg",
      );

      expect(result.crdtState).toBeInstanceOf(Buffer);
      expect(result.markdown).toContain("https://cdn.example.com/photo.jpg");
      expect(result.markdown).not.toContain("pending://upload-123");
    });
  });

  describe("replaceContent", () => {
    it("populates a fresh Y.Doc with markdown content and returns an update", () => {
      const ydoc = new Y.Doc();
      const result = service.replaceContent(ydoc, "# Hello\n\nWorld");

      expect(result.update).toBeInstanceOf(Buffer);
      expect(result.update.length).toBeGreaterThan(0);
      expect(result.markdown).toContain("Hello");
      expect(result.plainText).toContain("World");
    });

    it("replaces existing content on subsequent calls using the same Y.Doc", () => {
      const ydoc = new Y.Doc();

      const first = service.replaceContent(ydoc, "# First");
      expect(first.markdown).toContain("First");

      const second = service.replaceContent(ydoc, "# Second\n\nMore content");
      expect(second.markdown).toContain("Second");
      expect(second.markdown).not.toContain("First");
      expect(second.plainText).toContain("More content");
    });

    it("produces incremental updates that merge correctly with existing state", () => {
      const ydoc = new Y.Doc();
      service.replaceContent(ydoc, "# Start");
      const fullStateAfterFirst = Buffer.from(Y.encodeStateAsUpdate(ydoc));

      const secondResult = service.replaceContent(ydoc, "# Start\n\nAdded paragraph");

      // Apply the incremental update to a fresh doc that has the first state
      const verifyDoc = new Y.Doc();
      Y.applyUpdate(verifyDoc, fullStateAfterFirst);
      Y.applyUpdate(verifyDoc, secondResult.update);

      const mergedState = Buffer.from(Y.encodeStateAsUpdate(verifyDoc));
      const materialized = service.materialize(mergedState);
      expect(materialized.markdown).toContain("Added paragraph");
    });

    it("handles empty markdown gracefully", () => {
      const ydoc = new Y.Doc();
      const result = service.replaceContent(ydoc, "");
      expect(result.update).toBeInstanceOf(Buffer);
    });
  });
});
