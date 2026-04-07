const TYPE_NAME_MAP: Record<string, string> = {
  // marks
  emphasis: "em",
  inlineCode: "code_inline",
  strike_through: "strikethrough",
  // nodes
  bulletList: "bullet_list",
  orderedList: "ordered_list",
  listItem: "list_item",
  hardbreak: "hard_break",
  hr: "horizontal_rule",
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

  return out;
}
