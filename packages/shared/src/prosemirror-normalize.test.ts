import { describe, expect, it } from "vitest";
import { normalizeProsemirrorJsonForSlateSchema } from "./prosemirror-normalize";

describe("normalizeProsemirrorJsonForSlateSchema", () => {
  it("maps camelCase listItem nodes to slate schema names recursively", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "first" }],
                },
                {
                  type: "orderedList",
                  attrs: { order: 1 },
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "nested" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(normalizeProsemirrorJsonForSlateSchema(json)).toEqual({
      type: "doc",
      content: [
        {
          type: "bullet_list",
          content: [
            {
              type: "list_item",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "first" }],
                },
                {
                  type: "ordered_list",
                  attrs: { order: 1 },
                  content: [
                    {
                      type: "list_item",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "nested" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });
});
