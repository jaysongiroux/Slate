interface TocHeadingEntry {
  level: number;
  text: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Plain text from heading inline JSON (TipTap / ProseMirror JSON shape). */
function plainTextFromHeadingContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const node of content) {
    if (!isRecord(node)) continue;
    const t = node.type;
    if (t === "text" && typeof node.text === "string") {
      out += node.text;
    } else if (t === "hard_break") {
      out += "\n";
    } else if (Array.isArray(node.content)) {
      out += plainTextFromHeadingContent(node.content);
    }
  }
  return out;
}

function collectHeadingsFromDocJson(docJson: unknown): TocHeadingEntry[] {
  const out: TocHeadingEntry[] = [];

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    const o = node as Record<string, unknown>;
    if (o.type === "heading" && Array.isArray(o.content)) {
      const rawLevel = o.attrs && isRecord(o.attrs) ? o.attrs.level : 1;
      const level = typeof rawLevel === "number" && rawLevel >= 1 && rawLevel <= 6 ? rawLevel : 1;
      const text = plainTextFromHeadingContent(o.content).trim();
      out.push({ level, text: text.length > 0 ? text : "Untitled" });
    }
    if (Array.isArray(o.content)) {
      for (const c of o.content) walk(c);
    }
  }

  walk(docJson);
  return out;
}

function textParagraph(text: string): Record<string, unknown> {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

/** Nested bullet_list matching live TOC indentation (stack by heading level). */
function buildTocBulletListFromHeadings(headings: TocHeadingEntry[]): Record<string, unknown> {
  if (headings.length === 0) {
    return textParagraph("No headings found");
  }

  const root: Record<string, unknown> = { type: "bullet_list", content: [] };
  const stack: { level: number; list: Record<string, unknown> }[] = [{ level: 0, list: root }];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    while (stack.length > 1 && stack[stack.length - 1]!.level >= h.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1]!.list;
    const parentContent = parent.content as Record<string, unknown>[];

    const listItem: Record<string, unknown> = {
      type: "list_item",
      content: [textParagraph(h.text)],
    };
    parentContent.push(listItem);

    const next = headings[i + 1];
    if (next && next.level > h.level) {
      const nested: Record<string, unknown> = { type: "bullet_list", content: [] };
      (listItem.content as unknown[]).push(nested);
      stack.push({ level: h.level, list: nested });
    }
  }

  return root;
}

function transformNode(node: unknown, headings: TocHeadingEntry[]): unknown {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => transformNode(n, headings));

  const o = node as Record<string, unknown>;
  if (o.type === "tableOfContents") {
    return buildTocBulletListFromHeadings(headings);
  }

  const next: Record<string, unknown> = { ...o };
  if (Array.isArray(o.content)) {
    next.content = o.content.map((c) => transformNode(c, headings));
  }
  return next;
}

/**
 * Deep-clones document JSON and replaces every `tableOfContents` node with a
 * static nested list (or a placeholder paragraph when there are no headings).
 */
export function expandTableOfContentsInDocJson(docJson: unknown): unknown {
  if (!docJson || typeof docJson !== "object") return docJson;

  const root = docJson as Record<string, unknown>;
  if (root.type !== "doc" || !Array.isArray(root.content)) {
    try {
      return JSON.parse(JSON.stringify(docJson)) as unknown;
    } catch {
      return docJson;
    }
  }

  const headings = collectHeadingsFromDocJson(docJson);
  return transformNode(docJson, headings);
}
