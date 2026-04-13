import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MermaidBlock } from "../components/MermaidBlock";

/**
 * Extends CodeBlockLowlight so that code blocks with language="mermaid"
 * render an interactive preview via the MermaidBlock node view.
 */
export const MermaidCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, ...rest }) => {
      const language = node.attrs.language;
      if (language === "mermaid") {
        return ReactNodeViewRenderer(MermaidBlock)({ node, ...rest });
      }
      // Fall back to default rendering for all other languages
      return {};
    };
  },
});
