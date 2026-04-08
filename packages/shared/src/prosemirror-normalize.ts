const TYPE_NAME_MAP: Record<string, string> = {
  // marks (Milkdown names)
  emphasis: "em",
  inlineCode: "code_inline",
  strike_through: "strikethrough",
  // marks (TipTap names)
  bold: "strong",
  italic: "em",
  code: "code_inline",
  strike: "strikethrough",
  // nodes
  bulletList: "bullet_list",
  orderedList: "ordered_list",
  listItem: "list_item",
  taskList: "bullet_list",
  taskItem: "list_item",
  hardbreak: "hard_break",
  hr: "horizontal_rule",
  codeBlock: "code_block",
  horizontalRule: "horizontal_rule",
  hardBreak: "hard_break",
  tableRow: "table_row",
  tableCell: "table_cell",
  tableHeader: "table_header",
  tableHeaderRow: "table_header_row",
};

export function normalizeProsemirrorJsonForSlateSchema(json: any): any {
  if (json == null || typeof json !== "object") return json;
  if (Array.isArray(json)) return json.map(normalizeProsemirrorJsonForSlateSchema);

  const out: any = { ...json };

  if (out.type && TYPE_NAME_MAP[out.type]) {
    out.type = TYPE_NAME_MAP[out.type];
  }

  // Milkdown's "html" inline node has no equivalent in slateSchema.
  if (out.type === "html" && typeof out.attrs?.value === "string") {
    return { type: "text", text: out.attrs.value };
  }

  if (out.marks) {
    out.marks = out.marks.map(normalizeProsemirrorJsonForSlateSchema);
  }
  if (out.content) {
    out.content = out.content.map(normalizeProsemirrorJsonForSlateSchema);
  }

  // TipTap wraps table cell content in paragraphs (block+), but the backend
  // schema expects inline* directly.  Unwrap single-paragraph cells.
  if (
    (out.type === "table_cell" || out.type === "table_header") &&
    Array.isArray(out.content) &&
    out.content.length === 1 &&
    out.content[0].type === "paragraph"
  ) {
    out.content = out.content[0].content ?? [];
  }

  return out;
}
