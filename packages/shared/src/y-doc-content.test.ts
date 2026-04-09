import { describe, it, expect } from "vitest";
import { prosemirrorJSONToYDoc } from "y-prosemirror";
import { tiptapSchema } from "./tiptap-ydoc";
import { extractTiptapContentFromYDoc } from "./y-doc-content";

describe("extractTiptapContentFromYDoc", () => {
  it("returns insertable TipTap content from a Yjs document", () => {
    const ydoc = prosemirrorJSONToYDoc(
      tiptapSchema,
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Weekly review" }],
          },
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: {
                  checked: false,
                  listType: "bullet",
                },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Follow up with client" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      "prosemirror",
    );

    expect(extractTiptapContentFromYDoc(ydoc)).toEqual([
      {
        type: "paragraph",
        content: [{ type: "text", text: "Weekly review" }],
      },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: {
              checked: false,
            },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Follow up with client" }],
              },
            ],
          },
        ],
      },
    ]);
  });
});
