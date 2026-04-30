import { describe, expect, it } from "vitest";
import {
  DIAGRAM_ATTACHMENT_PREFIX,
  collectAttachmentIdReferences,
  remapAttachmentIdsInDiagramScene,
  remapAttachmentIdsInJsonTree,
  remapAttachmentIdsInMarkdown,
  remapAttachmentIdsInNoteContent,
  remapAttachmentIdsInString,
} from "./migration-references";

const map = { OLD_A: "NEW_A", OLD_B: "NEW_B" };

describe("remapAttachmentIdsInString", () => {
  it("rewrites a relative attachment URL", () => {
    expect(remapAttachmentIdsInString("/api/attachments/OLD_A/content", map)).toBe(
      "/api/attachments/NEW_A/content",
    );
  });

  it("rewrites an absolute http(s) attachment URL", () => {
    expect(
      remapAttachmentIdsInString(
        "https://example.com/api/attachments/OLD_A/content",
        map,
      ),
    ).toBe("https://example.com/api/attachments/NEW_A/content");
  });

  it("preserves query strings on attachment URLs", () => {
    expect(
      remapAttachmentIdsInString(
        "/api/attachments/OLD_A/content?token=xyz&v=2",
        map,
      ),
    ).toBe("/api/attachments/NEW_A/content?token=xyz&v=2");
  });

  it("rewrites multiple URLs in a single string", () => {
    const before =
      "see /api/attachments/OLD_A/content and /api/attachments/OLD_B/content thanks";
    const after =
      "see /api/attachments/NEW_A/content and /api/attachments/NEW_B/content thanks";
    expect(remapAttachmentIdsInString(before, map)).toBe(after);
  });

  it("leaves URLs alone whose id is not in the map", () => {
    expect(remapAttachmentIdsInString("/api/attachments/UNKNOWN/content", map)).toBe(
      "/api/attachments/UNKNOWN/content",
    );
  });

  it("leaves the string unchanged when the new id equals the old id (idempotent identity)", () => {
    expect(
      remapAttachmentIdsInString("/api/attachments/X/content", { X: "X" }),
    ).toBe("/api/attachments/X/content");
  });

  it("ignores non-attachment URLs", () => {
    expect(
      remapAttachmentIdsInString(
        "https://example.com/notes/OLD_A and /api/notes/OLD_A/raw",
        map,
      ),
    ).toBe("https://example.com/notes/OLD_A and /api/notes/OLD_A/raw");
  });

  it("returns empty input unchanged", () => {
    expect(remapAttachmentIdsInString("", map)).toBe("");
  });
});

describe("remapAttachmentIdsInJsonTree", () => {
  it("rewrites image src in TipTap-shaped JSON", () => {
    const before = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "/api/attachments/OLD_A/content", alt: "a" },
        },
      ],
    };
    const after = remapAttachmentIdsInJsonTree(before, map) as typeof before;
    expect(after.content[0]).toEqual({
      type: "image",
      attrs: { src: "/api/attachments/NEW_A/content", alt: "a" },
    });
  });

  it("does not mutate the input", () => {
    const before = {
      type: "image",
      attrs: { src: "/api/attachments/OLD_A/content" },
    };
    remapAttachmentIdsInJsonTree(before, map);
    expect(before.attrs.src).toBe("/api/attachments/OLD_A/content");
  });

  it("traverses nested structures (table cell holding an image)", () => {
    const tree = {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                {
                  type: "image",
                  attrs: { src: "https://x.test/api/attachments/OLD_B/content" },
                },
              ],
            },
          ],
        },
      ],
    };
    const after = remapAttachmentIdsInJsonTree(tree, map) as typeof tree;
    const cellImage = (after.content[0]!.content[0]!.content as any[])[0];
    expect(cellImage.attrs.src).toBe("https://x.test/api/attachments/NEW_B/content");
  });

  it("rewrites diagram attachment tokens", () => {
    const scene = {
      files: {
        excId1: {
          id: "excId1",
          dataURL: `${DIAGRAM_ATTACHMENT_PREFIX}OLD_A`,
          mimeType: "image/png",
        },
      },
    };
    const after = remapAttachmentIdsInJsonTree(scene, map) as typeof scene;
    expect(after.files.excId1.dataURL).toBe(`${DIAGRAM_ATTACHMENT_PREFIX}NEW_A`);
  });

  it("leaves non-attachment dataURLs (e.g. data:image) alone in the scene", () => {
    const scene = {
      files: {
        f1: { id: "f1", dataURL: "data:image/png;base64,AAAA" },
      },
    };
    const after = remapAttachmentIdsInJsonTree(scene, map) as typeof scene;
    expect(after.files.f1.dataURL).toBe("data:image/png;base64,AAAA");
  });

  it("returns null/undefined unchanged", () => {
    expect(remapAttachmentIdsInJsonTree(null, map)).toBe(null);
    expect(remapAttachmentIdsInJsonTree(undefined, map)).toBe(undefined);
  });

  it("returns numbers/booleans unchanged", () => {
    expect(remapAttachmentIdsInJsonTree(42, map)).toBe(42);
    expect(remapAttachmentIdsInJsonTree(true, map)).toBe(true);
  });

  it("rewrites strings inside arrays", () => {
    const before = ["plain", "/api/attachments/OLD_A/content"];
    expect(remapAttachmentIdsInJsonTree(before, map)).toEqual([
      "plain",
      "/api/attachments/NEW_A/content",
    ]);
  });

  it("preserves object keys (only values are rewritten)", () => {
    const before = {
      "/api/attachments/OLD_A/content": "value",
      attrs: { src: "/api/attachments/OLD_A/content" },
    };
    const after = remapAttachmentIdsInJsonTree(before, map) as Record<string, unknown>;
    // Keys are not rewritten — only values.
    expect(Object.keys(after)).toContain("/api/attachments/OLD_A/content");
    expect((after.attrs as { src: string }).src).toBe(
      "/api/attachments/NEW_A/content",
    );
  });
});

describe("remapAttachmentIdsInNoteContent (alias)", () => {
  it("delegates to the json tree walker", () => {
    const before = { type: "image", attrs: { src: "/api/attachments/OLD_A/content" } };
    const after = remapAttachmentIdsInNoteContent(before, map) as typeof before;
    expect(after.attrs.src).toBe("/api/attachments/NEW_A/content");
  });
});

describe("remapAttachmentIdsInMarkdown", () => {
  it("rewrites a single markdown image", () => {
    expect(
      remapAttachmentIdsInMarkdown(
        "![alt](/api/attachments/OLD_A/content)",
        map,
      ),
    ).toBe("![alt](/api/attachments/NEW_A/content)");
  });

  it("rewrites multiple markdown images on different lines", () => {
    const before = `![a](/api/attachments/OLD_A/content)\n![b](/api/attachments/OLD_B/content)`;
    const after = `![a](/api/attachments/NEW_A/content)\n![b](/api/attachments/NEW_B/content)`;
    expect(remapAttachmentIdsInMarkdown(before, map)).toBe(after);
  });

  it("rewrites attachments referenced via plain links, not just images", () => {
    expect(
      remapAttachmentIdsInMarkdown(
        "see [the doc](/api/attachments/OLD_A/content) please",
        map,
      ),
    ).toBe("see [the doc](/api/attachments/NEW_A/content) please");
  });

  it("leaves external markdown images untouched", () => {
    const md = "![ext](https://example.com/cat.png)";
    expect(remapAttachmentIdsInMarkdown(md, map)).toBe(md);
  });
});

describe("remapAttachmentIdsInDiagramScene", () => {
  it("rewrites attachment tokens deep inside the files map", () => {
    const scene = {
      type: "excalidraw",
      elements: [{ id: "rect-1" }],
      appState: { viewBackgroundColor: "#fff" },
      files: {
        e1: {
          id: "e1",
          dataURL: `${DIAGRAM_ATTACHMENT_PREFIX}OLD_A`,
          mimeType: "image/png",
        },
        e2: {
          id: "e2",
          dataURL: `${DIAGRAM_ATTACHMENT_PREFIX}OLD_B`,
          mimeType: "image/jpeg",
        },
      },
    };
    const after = remapAttachmentIdsInDiagramScene(scene, map) as typeof scene;
    expect(after.files.e1.dataURL).toBe(`${DIAGRAM_ATTACHMENT_PREFIX}NEW_A`);
    expect(after.files.e2.dataURL).toBe(`${DIAGRAM_ATTACHMENT_PREFIX}NEW_B`);
  });

  it("does not rewrite excalidraw element ids that incidentally match attachment ids", () => {
    const scene = {
      elements: [{ id: "OLD_A" }],
      files: {},
    };
    const after = remapAttachmentIdsInDiagramScene(scene, map) as typeof scene;
    // Element id "OLD_A" is not prefixed with `attachment:` so it stays intact.
    expect(after.elements[0]!.id).toBe("OLD_A");
  });
});

describe("collectAttachmentIdReferences (extensibility safety net)", () => {
  it("collects all attachment ids referenced across a tree", () => {
    const tree = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "/api/attachments/OLD_A/content" } },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "see /api/attachments/OLD_B/content for context",
            },
          ],
        },
      ],
      diagram: {
        files: {
          x: { dataURL: `${DIAGRAM_ATTACHMENT_PREFIX}OLD_A` },
          y: { dataURL: `${DIAGRAM_ATTACHMENT_PREFIX}OLD_C` },
        },
      },
    };
    expect(collectAttachmentIdReferences(tree)).toEqual(
      new Set(["OLD_A", "OLD_B", "OLD_C"]),
    );
  });

  it("returns an empty set when no references are present", () => {
    expect(collectAttachmentIdReferences({ type: "doc", content: [] })).toEqual(new Set());
  });

  it("when remapping covers everything the collector finds, the post-remap collector returns the remapped ids only", () => {
    const tree = {
      a: "/api/attachments/OLD_A/content",
      b: { c: `${DIAGRAM_ATTACHMENT_PREFIX}OLD_B` },
    };
    const remapped = remapAttachmentIdsInJsonTree(tree, map);
    expect(collectAttachmentIdReferences(remapped)).toEqual(new Set(["NEW_A", "NEW_B"]));
  });

  it("regression: any new attachment-reference shape introduced in the codebase should expand both the collector and the remapper", () => {
    // This test acts as documentation: if you add a new way to embed an
    // attachment id (e.g. a new node type, a new diagram dataURL prefix), you
    // must update both `remapAttachmentIdsInJsonTree` and
    // `collectAttachmentIdReferences` in lock-step. The two helpers are mirrors
    // of each other; the migration path depends on that invariant.
    const tree = {
      type: "image",
      attrs: { src: "/api/attachments/X/content" },
    };
    const collected = collectAttachmentIdReferences(tree);
    const remapped = remapAttachmentIdsInJsonTree(tree, { X: "Y" });
    expect(collected.has("X")).toBe(true);
    expect(collectAttachmentIdReferences(remapped).has("Y")).toBe(true);
  });
});
