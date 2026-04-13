import { Schema } from "prosemirror-model";

/**
 * Mapping from the backend slateSchema node names (snake_case) to TipTap's
 * expected node names (camelCase).  Used when creating Y.Doc content that
 * will be consumed by TipTap on the frontend.
 */
const BACKEND_TO_TIPTAP: Record<string, string> = {
  // nodes
  bullet_list: "bulletList",
  ordered_list: "orderedList",
  list_item: "listItem",
  code_block: "codeBlock",
  horizontal_rule: "horizontalRule",
  hard_break: "hardBreak",
  table_row: "tableRow",
  table_cell: "tableCell",
  table_header: "tableHeader",
  table_header_row: "tableRow",
  // marks
  strong: "bold",
  em: "italic",
  code_inline: "code",
  strikethrough: "strike",
};

/**
 * When a mixed bullet_list is split into multiple lists, the result is a
 * special `{ __expanded: [...] }` marker.  This function flattens those
 * markers back into the parent's content array.
 */
function flattenExpanded(arr: any[]): any[] {
  const result: any[] = [];
  for (const item of arr) {
    if (item && item.__expanded) {
      result.push(...item.__expanded);
    } else {
      result.push(item);
    }
  }
  return result;
}

/**
 * Transform ProseMirror JSON from backend schema names to TipTap-compatible
 * names. Also converts task list items (list_item with checked != null inside
 * a bullet_list) into taskList / taskItem nodes.
 */
export function toTiptapJson(json: any): any {
  if (json == null || typeof json !== "object") return json;
  if (Array.isArray(json)) return json.map(toTiptapJson);

  const out: any = { ...json };

  // Convert bullet_list that contains task items
  if (out.type === "bullet_list" && Array.isArray(out.content)) {
    const isTask = (child: any) => child.type === "list_item" && child.attrs?.checked != null;
    const hasTask = out.content.some(isTask);
    const hasRegular = out.content.some((c: any) => !isTask(c));

    if (hasTask && !hasRegular) {
      // All items are tasks → single taskList
      return {
        ...out,
        type: "taskList",
        content: out.content.map((child: any) => ({
          ...child,
          type: "taskItem",
          content: child.content?.map(toTiptapJson),
        })),
      };
    }

    if (hasTask && hasRegular) {
      // Mixed: split into consecutive runs of taskList and bulletList.
      // Returns an array of nodes (the caller handles doc.content splicing).
      const groups: any[] = [];
      let currentGroup: { isTask: boolean; items: any[] } | null = null;

      for (const child of out.content) {
        const childIsTask = isTask(child);
        if (!currentGroup || currentGroup.isTask !== childIsTask) {
          currentGroup = { isTask: childIsTask, items: [] };
          groups.push(currentGroup);
        }
        currentGroup.items.push(child);
      }

      // Mark this node for expansion by wrapping groups into separate lists
      const expanded = groups.map((g) => {
        if (g.isTask) {
          return {
            type: "taskList",
            content: g.items.map((child: any) => ({
              ...child,
              type: "taskItem",
              content: child.content?.map(toTiptapJson),
            })),
          };
        }
        return {
          type: "bulletList",
          content: g.items.map(toTiptapJson),
        };
      });

      // Return a special marker that flattenExpanded will handle
      return { __expanded: expanded };
    }
  }

  // Standard rename
  if (out.type && BACKEND_TO_TIPTAP[out.type]) {
    out.type = BACKEND_TO_TIPTAP[out.type];
  }

  // TipTap table cells expect block content (paragraphs), but the backend
  // schema stores inline content directly.  Wrap bare inlines in a paragraph.
  if ((out.type === "tableCell" || out.type === "tableHeader") && Array.isArray(out.content)) {
    const hasBlock = out.content.some(
      (c: any) => c.type === "paragraph" || c.type === "heading" || c.type === "bulletList",
    );
    if (!hasBlock) {
      out.content = [{ type: "paragraph", content: out.content.map(toTiptapJson) }];
      return out;
    }
  }

  // Lift inline images out of paragraphs — TipTap treats image as a block node.
  if (out.type === "paragraph" && Array.isArray(out.content)) {
    const hasImage = out.content.some((c: any) => c.type === "image");
    if (hasImage) {
      // Split into runs of non-image inlines (paragraphs) and images (block)
      const blocks: any[] = [];
      let inlines: any[] = [];
      for (const child of out.content) {
        if (child.type === "image") {
          if (inlines.length > 0) {
            blocks.push({ type: "paragraph", content: inlines.map(toTiptapJson) });
            inlines = [];
          }
          blocks.push(toTiptapJson(child));
        } else {
          inlines.push(child);
        }
      }
      if (inlines.length > 0) {
        blocks.push({ type: "paragraph", content: inlines.map(toTiptapJson) });
      }
      if (blocks.length === 1) return blocks[0];
      return { __expanded: blocks };
    }
  }

  if (out.content) {
    out.content = flattenExpanded(out.content.map(toTiptapJson));
  }
  if (out.marks) {
    out.marks = out.marks.map(toTiptapJson);
  }

  return out;
}

/**
 * A ProseMirror schema with TipTap-compatible (camelCase) node names.
 * Used exclusively for creating Y.Doc content via prosemirrorJSONToYDoc.
 * This schema mirrors slateSchema's structure but uses the names TipTap expects.
 */
export const tiptapSchema = new Schema({
  nodes: {
    doc: { content: "block+" },

    paragraph: {
      content: "inline*",
      group: "block",
    },

    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block",
      defining: true,
    },

    blockquote: {
      content: "block+",
      group: "block",
      defining: true,
    },

    codeBlock: {
      attrs: { language: { default: "" } },
      content: "text*",
      marks: "",
      group: "block",
      code: true,
      defining: true,
    },

    horizontalRule: {
      group: "block",
    },

    bulletList: {
      content: "listItem+",
      group: "block",
    },

    orderedList: {
      attrs: { order: { default: 1 } },
      content: "listItem+",
      group: "block",
    },

    listItem: {
      attrs: {
        checked: { default: null },
        listType: { default: "bullet" },
      },
      content: "paragraph block*",
      defining: true,
    },

    taskList: {
      content: "taskItem+",
      group: "block",
    },

    taskItem: {
      attrs: {
        checked: { default: false },
      },
      content: "paragraph block*",
      defining: true,
    },

    image: {
      attrs: {
        src: { default: null },
        alt: { default: null },
        title: { default: null },
      },
      group: "block",
      draggable: true,
    },

    hardBreak: {
      inline: true,
      group: "inline",
      selectable: false,
    },

    table: {
      content: "tableRow+",
      group: "block",
      tableRole: "table",
      isolating: true,
    },

    tableRow: {
      content: "(tableCell | tableHeader)+",
      tableRole: "row",
    },

    tableCell: {
      content: "block+",
      attrs: { colspan: { default: 1 }, rowspan: { default: 1 } },
      tableRole: "cell",
      isolating: true,
    },

    tableHeader: {
      content: "block+",
      attrs: { colspan: { default: 1 }, rowspan: { default: 1 } },
      tableRole: "header_cell",
      isolating: true,
    },

    text: { group: "inline" },
  },

  marks: {
    bold: {},
    italic: {},
    code: {},
    link: {
      attrs: { href: { default: "" }, title: { default: null } },
      inclusive: false,
    },
    strike: {},
  },
});
