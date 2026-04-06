import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  darkMode: true,
  fontFamily: "inherit",
  themeVariables: {
    darkMode: true,
    background: "transparent",
    primaryColor: "rgba(124, 92, 220, 0.3)",
    primaryTextColor: "rgba(255, 255, 255, 0.85)",
    primaryBorderColor: "rgba(124, 92, 220, 0.5)",
    lineColor: "rgba(255, 255, 255, 0.3)",
    secondaryColor: "rgba(255, 255, 255, 0.06)",
    tertiaryColor: "rgba(255, 255, 255, 0.03)",
    noteBkgColor: "rgba(124, 92, 220, 0.15)",
    noteTextColor: "rgba(255, 255, 255, 0.85)",
    noteBorderColor: "rgba(124, 92, 220, 0.3)",
  },
});

let mermaidCounter = 0;

export function MermaidBlock({ node }: NodeViewProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const idRef = useRef(`mermaid-${++mermaidCounter}`);

  const code = node.textContent;

  useEffect(() => {
    if (!previewRef.current || !code.trim()) {
      setError(null);
      return;
    }

    let cancelled = false;
    const id = idRef.current;

    (async () => {
      try {
        const valid = await mermaid.parse(code);
        if (cancelled || !valid) return;
        const { svg } = await mermaid.render(id, code);
        if (cancelled) return;
        previewRef.current!.innerHTML = svg;
        setError(null);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || "Invalid diagram");
        // Clear stale SVG on error
        if (previewRef.current) previewRef.current.innerHTML = "";
        // mermaid.render creates a detached element on failure — clean it up
        document.getElementById(`d${id}`)?.remove();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <NodeViewWrapper className="mermaid-block">
      <div className="mermaid-block__header">
        <span className="mermaid-block__label">mermaid</span>
        <button
          type="button"
          className="mermaid-block__toggle"
          onClick={() => setCollapsed((c) => !c)}
          contentEditable={false}
        >
          {collapsed ? "Show code" : "Hide code"}
        </button>
      </div>
      <div className={`mermaid-block__code ${collapsed ? "mermaid-block__code--collapsed" : ""}`}>
        <pre>
          <NodeViewContent as={"code" as any} />
        </pre>
      </div>
      {error ? (
        <div className="mermaid-block__error" contentEditable={false}>
          {error}
        </div>
      ) : (
        <div
          ref={previewRef}
          className="mermaid-block__preview"
          contentEditable={false}
        />
      )}
    </NodeViewWrapper>
  );
}
