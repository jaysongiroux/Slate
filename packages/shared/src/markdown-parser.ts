import { MarkdownParser } from "prosemirror-markdown";
import MarkdownIt from "markdown-it";
import { slateSchema } from "./schema";

const md = new MarkdownIt("commonmark", { html: false })
  .enable("table")
  .enable("strikethrough");

export const slateMarkdownParser = new MarkdownParser(slateSchema, md, {
  blockquote: { block: "blockquote" },
  paragraph: { block: "paragraph" },
  list_item: { block: "list_item" },
  bullet_list: { block: "bullet_list" },
  ordered_list: {
    block: "ordered_list",
    getAttrs: (tok) => ({ order: +(tok.attrGet("start") || 1) }),
  },
  heading: {
    block: "heading",
    getAttrs: (tok) => ({ level: +(tok.tag?.slice(1) || 1) }),
  },
  code_block: {
    block: "code_block",
    noCloseToken: true,
  },
  fence: {
    block: "code_block",
    getAttrs: (tok) => ({ language: tok.info || "" }),
    noCloseToken: true,
  },
  hr: { node: "horizontal_rule" },
  image: {
    node: "image",
    getAttrs: (tok) => ({
      src: tok.attrGet("src") || "",
      alt: tok.children?.[0]?.content || null,
      title: tok.attrGet("title") || null,
    }),
  },
  hardbreak: { node: "hard_break" },

  // GFM tables
  table: { block: "table" },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: "table_row" },
  th: { block: "table_header" },
  td: { block: "table_cell" },

  // Inline marks
  em: { mark: "em" },
  strong: { mark: "strong" },
  code_inline: { mark: "code_inline" },
  s: { mark: "strikethrough" },
  link: {
    mark: "link",
    getAttrs: (tok) => ({
      href: tok.attrGet("href") || "",
      title: tok.attrGet("title") || null,
    }),
  },

  // softbreak: treat as space
  softbreak: { node: "hard_break" },
});
