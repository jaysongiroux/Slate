import { slateSchema } from "./schema";

/**
 * Reverse of `BACKEND_TO_TIPTAP` in `tiptap-ydoc.ts` (excluding `tableRow`,
 * which maps from both `table_row` and `table_header_row` and is handled when
 * converting tables).
 */
const TIPTAP_TO_SLATE_NODE: Record<string, string> = {
  bulletList: "bullet_list",
  orderedList: "ordered_list",
  listItem: "list_item",
  codeBlock: "code_block",
  horizontalRule: "horizontal_rule",
  hardBreak: "hard_break",
  tableCell: "table_cell",
  tableHeader: "table_header",
};

const TIPTAP_TO_SLATE_MARK: Record<string, string> = {
  bold: "strong",
  italic: "em",
  code: "code_inline",
  strike: "strikethrough",
};

function slateNodeTypeForTipTap(tiptapType: string): string | null {
  const mapped = TIPTAP_TO_SLATE_NODE[tiptapType];
  if (mapped) return mapped;
  if (slateSchema.nodes[tiptapType]) return tiptapType;
  return null;
}

function emptyParagraph(): { type: "paragraph"; content: unknown[] } {
  return { type: "paragraph", content: [] };
}

function slateInlineImageFromTiptap(node: { attrs?: Record<string, unknown> }): {
  type: "image";
  attrs: { src: string; alt: null | string; title: null | string };
} {
  const a = node.attrs ?? {};
  return {
    type: "image",
    attrs: {
      src: (a.src as string | null | undefined) ?? "",
      alt: (a.alt as string | null | undefined) ?? null,
      title: (a.title as string | null | undefined) ?? null,
    },
  };
}

function convertMarks(marks: unknown[] | undefined): unknown[] {
  if (!marks?.length) return [];
  const out: unknown[] = [];
  for (const m of marks) {
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    const mark = m as { type?: string };
    const t = mark.type;
    if (!t) continue;
    const slateType = TIPTAP_TO_SLATE_MARK[t] ?? (slateSchema.marks[t] ? t : null);
    if (!slateType) continue;
    out.push({ ...mark, type: slateType });
  }
  return out;
}

function convertInlines(nodes: unknown[] | undefined): unknown[] {
  if (!nodes?.length) return [];
  return nodes.map((n) => convertInlineNode(n));
}

function convertInlineNode(node: unknown): unknown {
  if (node == null || typeof node !== "object" || Array.isArray(node)) return node;

  const n = node as { type?: string; marks?: unknown[]; content?: unknown[]; text?: string };

  if (n.type === "text") {
    return { type: "text", text: n.text ?? "", marks: convertMarks(n.marks) };
  }

  if (n.type === "hardBreak") {
    return { type: "hard_break" };
  }

  if (n.type === "image") {
    return slateInlineImageFromTiptap(n);
  }

  const slateType = slateNodeTypeForTipTap(n.type ?? "");
  if (!slateType) {
    return { type: "text", text: "" };
  }

  const spec = slateSchema.nodes[slateType]?.spec.content ?? "";
  if (spec === "inline*" || spec.includes("inline")) {
    return {
      ...n,
      type: slateType,
      content: convertInlines(n.content),
    };
  }

  return { type: "text", text: "" };
}

/** TipTap cell/header content is `block+`; slate cells use `inline*`. */
function tiptapCellBlocksToSlateInlines(blocks: unknown[] | undefined): unknown[] {
  if (!blocks?.length) return [];

  if (blocks.length === 1) {
    const only = blocks[0] as { type?: string; content?: unknown[] };
    if (only?.type === "paragraph") {
      return convertInlines(only.content);
    }
  }

  const chunks: unknown[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (i > 0) chunks.push({ type: "hard_break" });
    const b = blocks[i] as { type?: string; content?: unknown[] };
    if (b?.type === "paragraph") {
      chunks.push(...convertInlines(b.content));
    } else if (b?.type === "image") {
      chunks.push(slateInlineImageFromTiptap(b));
    } else if (b?.type === "heading") {
      chunks.push(...convertInlines(b.content));
    } else {
      chunks.push(...convertInlines([{ type: "text", text: "" }]));
    }
  }
  return chunks;
}

function convertTableRow(row: { content?: unknown[] }): unknown {
  const cells = (row.content ?? []) as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }[];
  const allHeaders =
    cells.length > 0 && cells.every((c) => c.type === "tableHeader");

  return {
    type: allHeaders ? "table_header_row" : "table_row",
    content: cells.map((cell) => {
      const slateCellType = cell.type === "tableHeader" ? "table_header" : "table_cell";
      return {
        type: slateCellType,
        attrs: {
          colspan: cell.attrs?.colspan ?? 1,
          rowspan: cell.attrs?.rowspan ?? 1,
        },
        content: tiptapCellBlocksToSlateInlines(cell.content),
      };
    }),
  };
}

function inferContentMode(slateType: string): "blocks" | "inlines" | "text" | "leaf" {
  const spec = slateSchema.nodes[slateType]?.spec.content ?? "";
  if (spec === "inline*") return "inlines";
  if (spec === "text*") return "text";
  if (!spec) return "leaf";
  return "blocks";
}

function convertBlockNode(node: unknown): unknown {
  if (node == null || typeof node !== "object" || Array.isArray(node)) return node;

  const n = node as {
    type?: string;
    attrs?: Record<string, unknown>;
    content?: unknown[];
    text?: string;
    marks?: unknown[];
  };

  if (n.type === "text") {
    return { type: "text", text: n.text ?? "", marks: convertMarks(n.marks) };
  }

  if (n.type === "taskList") {
    return {
      type: "bullet_list",
      content: (n.content ?? []).map((child) => {
        const c = child as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
        if (c.type !== "taskItem") {
          return convertBlockNode(child);
        }
        return {
          type: "list_item",
          attrs: {
            checked: Boolean(c.attrs?.checked),
            listType: (c.attrs?.listType as string | undefined) ?? "bullet",
          },
          content: convertListItemContent(c.content),
        };
      }),
    };
  }

  if (n.type === "image") {
    return {
      type: "paragraph",
      content: [slateInlineImageFromTiptap(n)],
    };
  }

  if (n.type === "table") {
    return {
      type: "table",
      content: (n.content ?? []).map((row) => convertTableRow(row as { content?: unknown[] })),
    };
  }

  if (n.type === "tableRow") {
    return convertTableRow(n);
  }

  const slateType = slateNodeTypeForTipTap(n.type ?? "");
  if (!slateType) {
    return emptyParagraph();
  }

  if (slateType === "list_item") {
    return {
      type: "list_item",
      attrs: {
        checked: n.attrs?.checked ?? null,
        listType: (n.attrs?.listType as string | undefined) ?? "bullet",
      },
      content: convertListItemContent(n.content),
    };
  }

  const mode = inferContentMode(slateType);

  if (mode === "inlines") {
    return {
      ...n,
      type: slateType,
      attrs: n.attrs,
      content: convertInlines(n.content),
    };
  }

  if (mode === "text") {
    return {
      ...n,
      type: slateType,
      attrs: n.attrs,
      content: (n.content ?? []).map((ch) => convertBlockNode(ch)),
    };
  }

  if (mode === "leaf") {
    const out: Record<string, unknown> = { type: slateType };
    if (n.attrs !== undefined) out.attrs = n.attrs;
    return out;
  }

  return {
    ...n,
    type: slateType,
    attrs: n.attrs,
    content: convertBlocks(n.content),
  };
}

function convertListItemContent(content: unknown[] | undefined): unknown[] {
  if (!content?.length) return [emptyParagraph()];
  return content.map((child) => convertBlockNode(child));
}

function convertBlocks(content: unknown[] | undefined): unknown[] {
  if (!content?.length) return [];
  return content.map((n) => convertBlockNode(n));
}

/**
 * Converts TipTap-stored document JSON to JSON compatible with `slateSchema`
 * and `Node.fromJSON`.
 */
export function tiptapDocJsonToSlateDocJson(root: unknown): { type: "doc"; content: unknown[] } {
  if (root == null || typeof root !== "object" || Array.isArray(root)) {
    return { type: "doc", content: [] };
  }

  const r = root as { type?: string; content?: unknown[] };
  if (r.type !== "doc") {
    return { type: "doc", content: [] };
  }

  return {
    type: "doc",
    content: convertBlocks(r.content),
  };
}
