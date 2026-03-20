import { Schema } from "prosemirror-model";

export const slateSchema = new Schema({
  nodes: {
    doc: { content: "block+" },

    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM() {
        return ["p", 0];
      },
    },

    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block",
      defining: true,
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
        tag: `h${level}`,
        attrs: { level },
      })),
      toDOM(node) {
        return [`h${node.attrs.level}`, 0];
      },
    },

    blockquote: {
      content: "block+",
      group: "block",
      defining: true,
      parseDOM: [{ tag: "blockquote" }],
      toDOM() {
        return ["blockquote", 0];
      },
    },

    code_block: {
      attrs: { language: { default: "" } },
      content: "text*",
      marks: "",
      group: "block",
      code: true,
      defining: true,
      parseDOM: [{ tag: "pre", preserveWhitespace: "full" as const }],
      toDOM() {
        return ["pre", ["code", 0]];
      },
    },

    horizontal_rule: {
      group: "block",
      parseDOM: [{ tag: "hr" }],
      toDOM() {
        return ["hr"];
      },
    },

    bullet_list: {
      content: "list_item+",
      group: "block",
      parseDOM: [{ tag: "ul" }],
      toDOM() {
        return ["ul", 0];
      },
    },

    ordered_list: {
      attrs: { order: { default: 1 } },
      content: "list_item+",
      group: "block",
      parseDOM: [{ tag: "ol" }],
      toDOM(node) {
        return node.attrs.order === 1
          ? ["ol", 0]
          : ["ol", { start: node.attrs.order }, 0];
      },
    },

    list_item: {
      attrs: {
        checked: { default: null },
        listType: { default: "bullet" },
      },
      content: "paragraph block*",
      defining: true,
      parseDOM: [{ tag: "li" }],
      toDOM() {
        return ["li", 0];
      },
    },

    image: {
      attrs: {
        src: { default: "" },
        alt: { default: null },
        title: { default: null },
      },
      inline: true,
      group: "inline",
      draggable: true,
      parseDOM: [{ tag: "img[src]" }],
      toDOM(node) {
        return ["img", node.attrs];
      },
    },

    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM() {
        return ["br"];
      },
    },

    table: {
      content: "(table_header_row | table_row)+",
      group: "block",
      tableRole: "table",
      isolating: true,
      parseDOM: [{ tag: "table" }],
      toDOM() {
        return ["table", ["tbody", 0]];
      },
    },

    table_header_row: {
      content: "(table_cell | table_header)+",
      tableRole: "row",
      parseDOM: [{ tag: "tr" }],
      toDOM() {
        return ["tr", 0];
      },
    },

    table_row: {
      content: "(table_cell | table_header)+",
      tableRole: "row",
      parseDOM: [{ tag: "tr" }],
      toDOM() {
        return ["tr", 0];
      },
    },

    table_cell: {
      content: "inline*",
      attrs: { colspan: { default: 1 }, rowspan: { default: 1 } },
      tableRole: "cell",
      isolating: true,
      parseDOM: [{ tag: "td" }],
      toDOM() {
        return ["td", 0];
      },
    },

    table_header: {
      content: "inline*",
      attrs: { colspan: { default: 1 }, rowspan: { default: 1 } },
      tableRole: "header_cell",
      isolating: true,
      parseDOM: [{ tag: "th" }],
      toDOM() {
        return ["th", 0];
      },
    },

    text: { group: "inline" },
  },

  marks: {
    strong: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM() {
        return ["strong", 0];
      },
    },

    em: {
      parseDOM: [{ tag: "em" }, { tag: "i" }],
      toDOM() {
        return ["em", 0];
      },
    },

    code_inline: {
      parseDOM: [{ tag: "code" }],
      toDOM() {
        return ["code", 0];
      },
    },

    link: {
      attrs: { href: { default: "" }, title: { default: null } },
      inclusive: false,
      parseDOM: [{ tag: "a[href]" }],
      toDOM(node) {
        return ["a", node.attrs, 0];
      },
    },

    strikethrough: {
      parseDOM: [{ tag: "del" }, { tag: "s" }],
      toDOM() {
        return ["del", 0];
      },
    },
  },
});
