import { describe, it, expect } from "vitest";
import { slateSchema } from "./schema";
import { slateMarkdownParser } from "./markdown-parser";
import { slateMarkdownSerializer } from "./markdown-serializer";

describe("slateSchema", () => {
  it("defines expected node types", () => {
    expect(slateSchema.nodes.doc).toBeDefined();
    expect(slateSchema.nodes.paragraph).toBeDefined();
    expect(slateSchema.nodes.heading).toBeDefined();
    expect(slateSchema.nodes.code_block).toBeDefined();
    expect(slateSchema.nodes.blockquote).toBeDefined();
    expect(slateSchema.nodes.bullet_list).toBeDefined();
    expect(slateSchema.nodes.ordered_list).toBeDefined();
    expect(slateSchema.nodes.list_item).toBeDefined();
    expect(slateSchema.nodes.table).toBeDefined();
    expect(slateSchema.nodes.image).toBeDefined();
  });

  it("defines expected mark types", () => {
    expect(slateSchema.marks.strong).toBeDefined();
    expect(slateSchema.marks.em).toBeDefined();
    expect(slateSchema.marks.code_inline).toBeDefined();
    expect(slateSchema.marks.link).toBeDefined();
    expect(slateSchema.marks.strikethrough).toBeDefined();
  });
});

describe("markdown round-trip", () => {
  it("parses and serializes a heading", () => {
    const md = "# Hello World\n";
    const doc = slateMarkdownParser.parse(md);
    expect(doc).toBeTruthy();
    const output = slateMarkdownSerializer.serialize(doc!);
    expect(output.trim()).toBe("# Hello World");
  });

  it("parses and serializes bold text", () => {
    const md = "This is **bold** text.\n";
    const doc = slateMarkdownParser.parse(md);
    const output = slateMarkdownSerializer.serialize(doc!);
    expect(output).toContain("**bold**");
  });

  it("parses and serializes a bullet list", () => {
    const md = "- item one\n- item two\n";
    const doc = slateMarkdownParser.parse(md);
    const output = slateMarkdownSerializer.serialize(doc!);
    expect(output).toContain("item one");
    expect(output).toContain("item two");
  });

  it("parses and serializes a code block", () => {
    const md = "```javascript\nconst x = 1;\n```\n";
    const doc = slateMarkdownParser.parse(md);
    const output = slateMarkdownSerializer.serialize(doc!);
    expect(output).toContain("const x = 1;");
  });

  it("parses and serializes an image", () => {
    const md = "![alt text](https://example.com/img.png)\n";
    const doc = slateMarkdownParser.parse(md);
    const output = slateMarkdownSerializer.serialize(doc!);
    expect(output).toContain("![alt text](https://example.com/img.png)");
  });

  it("parses and serializes an image with attachment URL", () => {
    const md = "![photo](/api/attachments/abc123/content)\n";
    const doc = slateMarkdownParser.parse(md);
    const output = slateMarkdownSerializer.serialize(doc!);
    expect(output).toContain("/api/attachments/abc123/content");
  });
});
