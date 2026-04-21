import { describe, expect, it } from "vitest";
import { noteContentToMarkdown } from "./export-note-markdown";

describe("noteContentToMarkdown", () => {
  it("serializes heading and paragraph to markdown with # and body text", () => {
    const content = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
    };
    const md = noteContentToMarkdown(content);
    expect(md).toContain("# Title");
    expect(md).toContain("Hello world");
  });

  it("expands tableOfContents to bullet lines, not an HTML TOC comment", () => {
    const content = {
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
    const md = noteContentToMarkdown(content);
    expect(md).not.toContain("<!-- toc -->");
    expect(md).toMatch(/^- Intro/m);
    expect(md).toContain("Details");
    expect(md.split("\n").some((line) => line.trimStart().startsWith("-"))).toBe(true);
  });

  it("can serialize nested lists without blank lines between list items", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Production" }] },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        { type: "paragraph", content: [{ type: "text", text: "Price: $10/mo" }] },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Staging" }] },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        { type: "paragraph", content: [{ type: "text", text: "Price: $5/mo" }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const md = noteContentToMarkdown(content, { tightLists: true });
    expect(md).toBe("- Production\n  - Price: $10/mo\n- Staging\n  - Price: $5/mo");
  });
});
