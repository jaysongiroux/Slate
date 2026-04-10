import { MarkdownSerializer } from "prosemirror-markdown";
import { Node as PmNode } from "prosemirror-model";

export const slateMarkdownSerializer = new MarkdownSerializer(
  {
    doc(state: any, node: PmNode) {
      state.renderContent(node);
    },

    paragraph(state: any, node: PmNode) {
      state.renderInline(node);
      state.closeBlock(node);
    },

    heading(state: any, node: PmNode) {
      state.write("#".repeat(node.attrs.level) + " ");
      state.renderInline(node);
      state.closeBlock(node);
    },

    blockquote(state: any, node: PmNode) {
      state.wrapBlock("> ", null, node, () => state.renderContent(node));
    },

    code_block(state: any, node: PmNode) {
      const lang = node.attrs.language || "";
      state.write("```" + lang + "\n");
      state.text(node.textContent, false);
      state.ensureNewLine();
      state.write("```");
      state.closeBlock(node);
    },

    horizontal_rule(state: any, node: PmNode) {
      state.write(node.attrs.markup || "---");
      state.closeBlock(node);
    },

    bullet_list(state: any, node: PmNode) {
      state.renderList(node, "  ", () => "- ");
    },

    ordered_list(state: any, node: PmNode) {
      const start = node.attrs.order || 1;
      const maxW = String(start + node.childCount - 1).length;
      const space = " ".repeat(maxW + 2);
      state.renderList(node, space, (i: number) => {
        const nStr = String(start + i);
        return nStr + ". ";
      });
    },

    list_item(state: any, node: PmNode) {
      if (node.attrs.checked != null) {
        state.write(node.attrs.checked ? "[x] " : "[ ] ");
      }
      state.renderContent(node);
    },

    image(state: any, node: PmNode) {
      const alt = state.esc(node.attrs.alt || "");
      const src = node.attrs.src || "";
      const title = node.attrs.title;
      if (title) {
        state.write(`![${alt}](${src} "${state.esc(title)}")`);
      } else {
        state.write(`![${alt}](${src})`);
      }
    },

    hard_break(state: any) {
      state.write("  \n");
    },

    table(state: any, node: PmNode) {
      // Collect all rows
      const rows: PmNode[] = [];
      node.forEach((row) => rows.push(row));

      if (rows.length === 0) {
        state.closeBlock(node);
        return;
      }

      // Determine column widths
      const colCount = rows[0].childCount;
      const colWidths: number[] = new Array(colCount).fill(3);

      for (const row of rows) {
        row.forEach((cell, _offset, index) => {
          const text = cell.textContent;
          colWidths[index] = Math.max(colWidths[index], text.length);
        });
      }

      // Render header row
      const headerRow = rows[0];
      const headerCells: string[] = [];
      headerRow.forEach((cell, _offset, index) => {
        headerCells.push(cell.textContent.padEnd(colWidths[index]));
      });
      state.write("| " + headerCells.join(" | ") + " |\n");

      // Render separator
      const separators = colWidths.map((w) => "-".repeat(w));
      state.write("| " + separators.join(" | ") + " |\n");

      // Render body rows
      for (let i = 1; i < rows.length; i++) {
        const cells: string[] = [];
        rows[i].forEach((cell, _offset, index) => {
          cells.push(cell.textContent.padEnd(colWidths[index]));
        });
        state.write("| " + cells.join(" | ") + " |\n");
      }
      state.closeBlock(node);
    },

    table_header_row() {
      // handled by table
    },

    table_row() {
      // handled by table
    },

    table_cell() {
      // handled by table
    },

    table_header() {
      // handled by table
    },

    tableOfContents(state: any, node: PmNode) {
      state.write("<!-- toc -->");
      state.closeBlock(node);
    },

    text(state: any, node: PmNode) {
      state.text(node.text || "");
    },
  },
  {
    strong: {
      open: "**",
      close: "**",
      mixable: true,
      expelEnclosingWhitespace: true,
    },

    em: {
      open: "*",
      close: "*",
      mixable: true,
      expelEnclosingWhitespace: true,
    },

    code_inline: {
      open(_: any, _mark: any, parent: PmNode, index: number) {
        return backticksFor(parent, index, false);
      },
      close(_: any, _mark: any, parent: PmNode, index: number) {
        return backticksFor(parent, index, true);
      },
      escape: false,
    },

    link: {
      open: "[",
      close(state: any, mark: any) {
        const title = mark.attrs.title;
        if (title) {
          return `](${mark.attrs.href} "${state.esc(title)}")`;
        }
        return `](${mark.attrs.href})`;
      },
    },

    strikethrough: {
      open: "~~",
      close: "~~",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
  },
);

function backticksFor(node: PmNode, index: number, closing: boolean) {
  let ticks = "`";
  if (closing && index > 0) {
    const prev = node.child(index - 1);
    if (prev.isText && prev.text && /`+$/.test(prev.text)) {
      ticks = "`".repeat(prev.text.match(/`+$/)![0].length + 1);
    }
  }
  if (!closing && index < node.childCount - 1) {
    const next = node.child(index + 1);
    if (next.isText && next.text && /^`+/.test(next.text)) {
      ticks = "`".repeat(next.text.match(/^`+/)![0].length + 1);
    }
  }
  return ticks;
}
