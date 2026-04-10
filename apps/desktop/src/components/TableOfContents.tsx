import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEffect, useState, useCallback } from "react";

interface TocEntry {
  level: number;
  text: string;
  pos: number;
}

export function TableOfContents({ editor }: NodeViewProps) {
  const [entries, setEntries] = useState<TocEntry[]>([]);

  const scanHeadings = useCallback(() => {
    const next: TocEntry[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        next.push({ level: node.attrs.level, text: node.textContent, pos });
      }
    });
    setEntries(next);
  }, [editor]);

  useEffect(() => {
    scanHeadings();
    editor.on("update", scanHeadings);
    return () => {
      editor.off("update", scanHeadings);
    };
  }, [editor, scanHeadings]);

  const scrollTo = (pos: number) => {
    const domAtPos = editor.view.domAtPos(pos + 1);
    const el = domAtPos.node instanceof HTMLElement ? domAtPos.node : domAtPos.node.parentElement;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <NodeViewWrapper className="toc-block" contentEditable={false}>
      <div className="toc-block__header">Table of Contents</div>
      {entries.length === 0 ? (
        <div className="toc-block__empty">No headings found</div>
      ) : (
        <ul className="toc-block__list">
          {entries.map((entry) => (
            <li
              key={entry.pos}
              className="toc-block__item"
              style={{ paddingLeft: `${(entry.level - 1) * 16}px` }}
            >
              <button type="button" className="toc-block__link" onClick={() => scrollTo(entry.pos)}>
                {entry.text || "Untitled"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </NodeViewWrapper>
  );
}
