import { MarkdownParser } from "prosemirror-markdown";
import MarkdownIt from "markdown-it";
import { Node as PmNode, Fragment } from "prosemirror-model";
import { slateSchema } from "./schema";

const md = new MarkdownIt("commonmark", { html: false }).enable("table").enable("strikethrough");

const rawParser = new MarkdownParser(slateSchema, md, {
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

/**
 * Convert the first table_row containing only table_header cells
 * into a table_header_row, so the structure matches Milkdown's GFM schema.
 */
function convertHeaderRows(node: PmNode): PmNode {
  if (node.type.name === "table") {
    const children: PmNode[] = [];
    let changed = false;
    node.forEach((child, _offset, index) => {
      if (index === 0 && child.type.name === "table_row") {
        let allHeaders = true;
        child.forEach((cell) => {
          if (cell.type.name !== "table_header") allHeaders = false;
        });
        if (allHeaders) {
          const headerRowType = slateSchema.nodes.table_header_row;
          children.push(headerRowType.create(child.attrs, child.content));
          changed = true;
          return;
        }
      }
      children.push(child);
    });
    if (changed) {
      return node.type.create(node.attrs, Fragment.from(children), node.marks);
    }
    return node;
  }

  // Recurse into block nodes
  const children: PmNode[] = [];
  let changed = false;
  node.forEach((child) => {
    const newChild = convertHeaderRows(child);
    if (newChild !== child) changed = true;
    children.push(newChild);
  });
  if (changed) {
    return node.type.create(node.attrs, Fragment.from(children), node.marks);
  }
  return node;
}

/**
 * Detect task list items: list_items whose first paragraph starts with
 * "[ ] " or "[x] " / "[X] ". Strip the checkbox text and set the
 * `checked` attribute accordingly.
 */
function convertTaskListItems(node: PmNode): PmNode {
  if (node.type.name === "list_item" && node.childCount > 0) {
    const firstChild = node.child(0);
    if (firstChild.type.name === "paragraph" && firstChild.childCount > 0) {
      const firstInline = firstChild.child(0);
      if (firstInline.isText && firstInline.text) {
        const match = firstInline.text.match(/^\[([ xX])\]\s?/);
        if (match) {
          const checked = match[1] !== " ";
          const remaining = firstInline.text.slice(match[0].length);
          const newChildren: PmNode[] = [];
          if (remaining) {
            newChildren.push(slateSchema.text(remaining, firstInline.marks));
          }
          for (let i = 1; i < firstChild.childCount; i++) {
            newChildren.push(firstChild.child(i));
          }
          const newParagraph = firstChild.type.create(
            firstChild.attrs,
            newChildren.length > 0 ? Fragment.from(newChildren) : undefined,
            firstChild.marks,
          );
          const restChildren: PmNode[] = [newParagraph];
          for (let i = 1; i < node.childCount; i++) {
            restChildren.push(convertTaskListItems(node.child(i)));
          }
          return node.type.create(
            { ...node.attrs, checked },
            Fragment.from(restChildren),
            node.marks,
          );
        }
      }
    }
  }

  // Recurse into block nodes
  const children: PmNode[] = [];
  let changed = false;
  node.forEach((child) => {
    const newChild = convertTaskListItems(child);
    if (newChild !== child) changed = true;
    children.push(newChild);
  });
  if (changed) {
    return node.type.create(node.attrs, Fragment.from(children), node.marks);
  }
  return node;
}

export const slateMarkdownParser = {
  parse(text: string): PmNode | null {
    const node = rawParser.parse(text);
    if (!node) return null;
    const withHeaders = convertHeaderRows(node);
    return convertTaskListItems(withHeaders);
  },
};
