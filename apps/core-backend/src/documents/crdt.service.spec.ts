import { CrdtService } from "./crdt.service";
import * as Y from "yjs";

/**
 * Walk a Y.XmlFragment and collect all element node names.
 * Used to verify Y.Doc structure matches TipTap's expected schema.
 */
function collectXmlNodeNames(fragment: Y.XmlFragment): string[] {
  const names: string[] = [];
  function walk(el: Y.XmlElement | Y.XmlText) {
    if (el instanceof Y.XmlElement) {
      names.push(el.nodeName);
      for (let i = 0; i < el.length; i++) {
        walk(el.get(i) as Y.XmlElement | Y.XmlText);
      }
    }
  }
  for (let i = 0; i < fragment.length; i++) {
    walk(fragment.get(i) as Y.XmlElement | Y.XmlText);
  }
  return names;
}

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
      const { crdtState } = service.bootstrapFromMarkdown("# Title\n\nSome paragraph text");
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

  describe("Y.Doc TipTap compatibility", () => {
    const FRAGMENT = "prosemirror";

    function getFragmentNames(crdtState: Buffer): string[] {
      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, crdtState);
      return collectXmlNodeNames(ydoc.getXmlFragment(FRAGMENT));
    }

    it("should use camelCase node names for bullet lists", () => {
      const result = service.bootstrapFromMarkdown("- item one\n- item two\n");
      const names = getFragmentNames(result.crdtState);

      expect(names).toContain("bulletList");
      expect(names).toContain("listItem");
      expect(names).not.toContain("bullet_list");
      expect(names).not.toContain("list_item");
    });

    it("should use camelCase node names for ordered lists", () => {
      const result = service.bootstrapFromMarkdown("1. first\n2. second\n");
      const names = getFragmentNames(result.crdtState);

      expect(names).toContain("orderedList");
      expect(names).toContain("listItem");
      expect(names).not.toContain("ordered_list");
      expect(names).not.toContain("list_item");
    });

    it("should use taskList/taskItem for task list items", () => {
      const result = service.bootstrapFromMarkdown("- [ ] todo\n- [x] done\n");
      const names = getFragmentNames(result.crdtState);

      expect(names).toContain("taskList");
      expect(names).toContain("taskItem");
      expect(names).not.toContain("bullet_list");
      expect(names).not.toContain("list_item");
    });

    it("should use only TipTap-compatible node names for tables", () => {
      const md = "| a | b |\n|---|---|\n| 1 | 2 |\n";
      const result = service.bootstrapFromMarkdown(md);
      const names = getFragmentNames(result.crdtState);

      // TipTap table extensions register: table, tableRow, tableCell, tableHeader
      // TipTap has NO tableHeaderRow — header rows are just tableRow with tableHeader cells
      expect(names).toContain("table");
      expect(names).toContain("tableRow");
      expect(names).toContain("tableCell");
      expect(names).toContain("tableHeader");
      expect(names).not.toContain("tableHeaderRow");
      expect(names).not.toContain("table_row");
      expect(names).not.toContain("table_cell");
      expect(names).not.toContain("table_header");
      expect(names).not.toContain("table_header_row");
    });

    it("should round-trip a table through bootstrap and materialize", () => {
      const md = "| Name | Age |\n|---|---|\n| Alice | 30 |\n| Bob | 25 |\n";
      const result = service.bootstrapFromMarkdown(md);

      expect(result.markdown).toContain("Name");
      expect(result.markdown).toContain("Alice");
      expect(result.markdown).toContain("Bob");
      // Should have table separator line
      expect(result.markdown).toMatch(/\|[-\s|]+\|/);
    });

    it("should preserve empty task list items through round-trip", () => {
      const md = "# Todo\n\n- [ ]  \n";
      const result = service.bootstrapFromMarkdown(md);
      const names = getFragmentNames(result.crdtState);

      expect(names).toContain("taskList");
      expect(names).toContain("taskItem");
      // Materialized markdown should still contain a task list marker
      expect(result.markdown).toMatch(/- \[ \]/);
    });

    it("should preserve empty bullet list items through round-trip", () => {
      const md = "# Notes\n\n-  \n";
      const result = service.bootstrapFromMarkdown(md);
      const names = getFragmentNames(result.crdtState);

      expect(names).toContain("bulletList");
      expect(names).toContain("listItem");
      expect(result.markdown).toContain("- ");
    });

    it("should use camelCase for code blocks and horizontal rules", () => {
      const md = "```js\nconst x = 1;\n```\n\n---\n";
      const result = service.bootstrapFromMarkdown(md);
      const names = getFragmentNames(result.crdtState);

      expect(names).toContain("codeBlock");
      expect(names).toContain("horizontalRule");
      expect(names).not.toContain("code_block");
      expect(names).not.toContain("horizontal_rule");
    });

    it("should use camelCase in replaceContent as well", () => {
      const ydoc = new Y.Doc();
      service.replaceContent(ydoc, "- [ ] task\n- item\n");
      const names = collectXmlNodeNames(ydoc.getXmlFragment(FRAGMENT));

      expect(names).toContain("taskList");
      expect(names).toContain("taskItem");
      expect(names).toContain("bulletList");
      expect(names).toContain("listItem");
      expect(names).not.toContain("bullet_list");
      expect(names).not.toContain("list_item");
    });
  });
});
