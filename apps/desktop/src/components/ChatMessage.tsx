import { useMemo } from "react";

export interface ChatMessageProps {
  role: "USER" | "ASSISTANT";
  content: string;
  onNoteClick?: (documentId: string) => void;
}

type TextPart = { kind: "text"; value: string };
type ChipPart = { kind: "chip"; title: string; documentId: string };
type ContentPart = TextPart | ChipPart;

const NOTE_LINK_RE = /\[([^\]]+)\]\(note:\/\/([^)]+)\)/g;

function parseContent(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  NOTE_LINK_RE.lastIndex = 0;
  while ((match = NOTE_LINK_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ kind: "text", value: content.slice(lastIndex, match.index) });
    }
    parts.push({ kind: "chip", title: match[1], documentId: match[2] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({ kind: "text", value: content.slice(lastIndex) });
  }

  return parts;
}

export function ChatMessage({ role, content, onNoteClick }: ChatMessageProps) {
  const parts = useMemo(() => parseContent(content), [content]);

  const isUser = role === "USER";

  const containerStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: isUser ? "flex-end" : "flex-start",
    marginBottom: "8px",
  };

  const bubbleStyle: React.CSSProperties = {
    maxWidth: "85%",
    padding: "8px 12px",
    fontSize: "12px",
    lineHeight: 1.5,
    borderRadius: isUser ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
    backgroundColor: isUser ? "rgba(108, 99, 255, 0.2)" : "#22224a",
    border: isUser ? "none" : "1px solid #2a2a4a",
    color: "#e0e0e0",
    wordBreak: "break-word",
  };

  const chipStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    fontSize: "10px",
    color: "#6c63ff",
    backgroundColor: "rgba(108, 99, 255, 0.13)",
    border: "1px solid rgba(108, 99, 255, 0.2)",
    borderRadius: "4px",
    padding: "1px 6px",
    margin: "0 2px",
    cursor: "pointer",
    verticalAlign: "middle",
    lineHeight: 1.6,
    userSelect: "none",
  };

  return (
    <div style={containerStyle}>
      <div style={bubbleStyle}>
        {parts.map((part, i) => {
          if (part.kind === "text") {
            return <span key={i}>{part.value}</span>;
          }
          return (
            <span
              key={i}
              style={chipStyle}
              onClick={() => onNoteClick?.(part.documentId)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onNoteClick?.(part.documentId);
                }
              }}
              title={`Open note: ${part.title}`}
            >
              {part.title}
            </span>
          );
        })}
      </div>
    </div>
  );
}
