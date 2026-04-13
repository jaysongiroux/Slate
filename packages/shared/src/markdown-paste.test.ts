import { describe, it, expect } from "vitest";
import { parseMarkdownForTiptapPaste } from "./markdown-paste";

describe("parseMarkdownForTiptapPaste", () => {
  it("converts standard markdown task lists into TipTap task nodes", () => {
    const content = parseMarkdownForTiptapPaste("- [x] convert to tailwind\n- [ ] import button\n");

    expect(content).toEqual([
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: {
              checked: true,
              listType: "bullet",
            },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "convert to tailwind" }],
              },
            ],
          },
          {
            type: "taskItem",
            attrs: {
              checked: false,
              listType: "bullet",
            },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "import button" }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("normalizes loose checklist lines into a TipTap task list", () => {
    const content = parseMarkdownForTiptapPaste("[x] google oauth\n[ ] Supports linking email\n");

    expect(content).toEqual([
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: {
              checked: true,
              listType: "bullet",
            },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "google oauth" }],
              },
            ],
          },
          {
            type: "taskItem",
            attrs: {
              checked: false,
              listType: "bullet",
            },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Supports linking email" }],
              },
            ],
          },
        ],
      },
    ]);
  });
});
