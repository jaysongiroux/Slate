import { describe, expect, it } from "vitest";
import { Node } from "prosemirror-model";
import { expandTableOfContentsInDocJson } from "./export-expand-toc";
import { slateSchema } from "./schema";

describe("expandTableOfContentsInDocJson", () => {
  it("replaces tableOfContents with nested bullets for headings", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
        { type: "tableOfContents" },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Details" }],
        },
      ],
    };
    const out = expandTableOfContentsInDocJson(doc) as {
      content: Array<Record<string, unknown>>;
    };
    const tocIdx = out.content.findIndex((n) => n.type === "bullet_list");
    expect(tocIdx).toBeGreaterThan(-1);
    const mdLike = JSON.stringify(out);
    expect(mdLike).toContain("Intro");
    expect(mdLike).toContain("Details");

    const tocList = out.content[tocIdx] as {
      type: string;
      content: Array<{ type: string; content: unknown[] }>;
    };
    expect(tocList.content[0]!.type).toBe("list_item");
    const firstLi = tocList.content[0]!;
    const para = firstLi.content[0] as { type: string; content: Array<{ text?: string }> };
    expect(para.type).toBe("paragraph");
    expect(para.content[0]!.text).toBe("Intro");
    const nested = firstLi.content.find((c) => (c as { type: string }).type === "bullet_list") as {
      content: Array<{ content: Array<{ content: Array<{ text?: string }> }> }>;
    };
    expect(nested).toBeDefined();
    expect(nested.content[0]!.content[0]!.content[0]!.text).toBe("Details");

    const pmDoc = Node.fromJSON(slateSchema, out);
    expect(pmDoc.type.name).toBe("doc");
    expect(() => pmDoc.check()).not.toThrow();
  });

  it("replaces tableOfContents with a placeholder paragraph when there are no headings", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }, { type: "tableOfContents" }],
    };
    const out = expandTableOfContentsInDocJson(doc) as { content: Array<Record<string, unknown>> };
    expect(out.content[1]!.type).toBe("paragraph");
    const p = out.content[1] as { content: Array<{ text?: string }> };
    expect(p.content[0]!.text).toBe("No headings found");

    const pmDoc = Node.fromJSON(slateSchema, out);
    expect(() => pmDoc.check()).not.toThrow();
  });
});
