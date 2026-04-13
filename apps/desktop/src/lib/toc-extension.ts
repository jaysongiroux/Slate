import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { TableOfContents } from "../components/TableOfContents";

export const TableOfContentsExtension = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,

  parseHTML() {
    return [{ tag: "div[data-type='toc']" }];
  },

  renderHTML() {
    return ["div", { "data-type": "toc" }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableOfContents);
  },
});
