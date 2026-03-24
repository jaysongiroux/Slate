import { useMemo } from "react";
import type { KeyboardEvent } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import {
  parseNoteLinkMarkdown,
  type NoteLinkMarkdownPart,
} from "../lib/noteLinkMarkdown";
import { FileText } from "lucide-react";

type ChipPart = Extract<NoteLinkMarkdownPart, { kind: "chip" }>;

/** Leading note chips (ignoring whitespace-only text) vs rest of the message for layout. */
function splitLeadingRefs(parts: NoteLinkMarkdownPart[]): {
  refs: ChipPart[];
  body: NoteLinkMarkdownPart[];
} {
  const refs: ChipPart[] = [];
  let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (p.kind === "text" && /^\s*$/.test(p.value)) {
      i += 1;
      continue;
    }
    if (p.kind === "chip") {
      refs.push(p);
      i += 1;
      continue;
    }
    break;
  }
  return { refs, body: parts.slice(i) };
}

function hasRenderableBody(body: NoteLinkMarkdownPart[]) {
  return body.some(
    (p) => p.kind === "chip" || (p.kind === "text" && p.value.trim() !== ""),
  );
}

const chatMarkdownComponents: Components = {
  a: ({ href, children, ...props }) => (
    <a
      {...props}
      className="chat-message__md-a"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
    </a>
  ),
};

function NoteChip({
  part,
  onNoteClick,
}: {
  part: ChipPart;
  onNoteClick?: (documentId: string) => void;
}) {
  return (
    <span
      className="chat-message__chip"
      onClick={() => onNoteClick?.(part.documentId)}
      role="button"
      tabIndex={0}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNoteClick?.(part.documentId);
        }
      }}
      title={`Open note: ${part.title}`}
    >
      <FileText size={10} color="var(--text-muted)" strokeWidth={2.5} aria-hidden />
      {part.title}
    </span>
  );
}

function renderContentParts(
  parts: NoteLinkMarkdownPart[],
  onNoteClick?: (documentId: string) => void,
) {
  return parts.map((part, i) => {
    if (part.kind === "text") {
      if (!part.value) return null;
      return (
        <span key={i} className="chat-message__md">
          <Markdown components={chatMarkdownComponents}>{part.value}</Markdown>
        </span>
      );
    }
    return <NoteChip key={i} part={part} onNoteClick={onNoteClick} />;
  });
}

export interface ChatMessageProps {
  role: "USER" | "ASSISTANT";
  content: string;
  onNoteClick?: (documentId: string) => void;
}

export function ChatMessage({ role, content, onNoteClick }: ChatMessageProps) {
  const isUser = role === "USER";
  const { parts, refs, body } = useMemo(() => {
    const parsed = parseNoteLinkMarkdown(content);
    const { refs, body } = splitLeadingRefs(parsed);
    return { parts: parsed, refs, body };
  }, [content]);
  // Placeholder assistant rows (streaming / tool phase) have no text yet — skip the bubble shell;
  // ChatSidebar shows typing dots or tool status instead.
  if (role === "ASSISTANT" && content.trim() === "") {
    return null;
  }

  return (
    <div className={isUser ? "chat-message chat-message--user" : "chat-message chat-message--assistant"}>
      <div
        className={
          isUser ? "chat-message__bubble chat-message__bubble--user" : "chat-message__bubble chat-message__bubble--assistant"
        }
      >
        {refs.length > 0 ? (
          <div className="chat-message__refs" aria-label="Referenced notes">
            {refs.map((part, i) => (
              <NoteChip
                key={`ref-${part.documentId}-${i}`}
                part={part}
                onNoteClick={onNoteClick}
              />
            ))}
          </div>
        ) : null}
        {refs.length > 0 && hasRenderableBody(body) ? (
          <div className="chat-message__body">{renderContentParts(body, onNoteClick)}</div>
        ) : refs.length === 0 ? (
          renderContentParts(parts, onNoteClick)
        ) : null}
      </div>
    </div>
  );
}
