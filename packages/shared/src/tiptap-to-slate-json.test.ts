import { describe, expect, it } from "vitest";
import { Node } from "prosemirror-model";
import { slateSchema } from "./schema";
import { tiptapDocJsonToSlateDocJson } from "./tiptap-to-slate-json";

describe("tiptapDocJsonToSlateDocJson", () => {
  it("converts bulletList to bullet_list for slateSchema (Node.fromJSON)", () => {
    const tiptap = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
            },
          ],
        },
      ],
    };
    const slateJson = tiptapDocJsonToSlateDocJson(tiptap);
    const doc = Node.fromJSON(slateSchema, slateJson);
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild!.type.name).toBe("bullet_list");
    expect(doc.firstChild!.firstChild!.type.name).toBe("list_item");
    expect(doc.firstChild!.firstChild!.textContent).toBe("one");
  });

  it("maps taskList/taskItem to bullet_list with list_item attrs.checked", () => {
    const tiptap = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "done" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const slateJson = tiptapDocJsonToSlateDocJson(tiptap);
    const doc = Node.fromJSON(slateSchema, slateJson);
    expect(doc.firstChild!.type.name).toBe("bullet_list");
    const li = doc.firstChild!.firstChild!;
    expect(li.type.name).toBe("list_item");
    expect(li.attrs.checked).toBe(true);
    expect(li.textContent).toBe("done");
  });

  it("wraps block-level TipTap image in a paragraph with inline image", () => {
    const tiptap = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "/x", alt: "a", title: null },
        },
      ],
    };
    const slateJson = tiptapDocJsonToSlateDocJson(tiptap);
    const doc = Node.fromJSON(slateSchema, slateJson);
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild!.type.name).toBe("paragraph");
    expect(doc.firstChild!.childCount).toBe(1);
    expect(doc.firstChild!.firstChild!.type.name).toBe("image");
    expect(doc.firstChild!.firstChild!.attrs.src).toBe("/x");
    expect(doc.firstChild!.firstChild!.attrs.alt).toBe("a");
  });

  it("converts a minimal table with header row", () => {
    const tiptap = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "H1" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "H2" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "A" }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "B" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const slateJson = tiptapDocJsonToSlateDocJson(tiptap);
    const doc = Node.fromJSON(slateSchema, slateJson);
    const table = doc.firstChild!;
    expect(table.type.name).toBe("table");
    expect(table.childCount).toBe(2);
    expect(table.child(0).type.name).toBe("table_header_row");
    expect(table.child(0).child(0).type.name).toBe("table_header");
    expect(table.child(0).child(1).type.name).toBe("table_header");
    expect(table.child(1).type.name).toBe("table_row");
    expect(table.child(1).child(0).type.name).toBe("table_cell");
    expect(table.child(1).child(0).textContent).toBe("A");
  });
});
