import { useMemo } from "react";
import type { KeyboardEvent } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import { parseNoteLinkMarkdown, type NoteLinkMarkdownPart } from "../lib/noteLinkMarkdown";
import { FileText } from "lucide-react";
import { cn } from "../lib/utils";

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
  return body.some((p) => p.kind === "chip" || (p.kind === "text" && p.value.trim() !== ""));
}

const mdBubbleProse =
  "[&_p]:my-[0.35em] [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_em]:italic [&_ul]:my-[0.35em] [&_ul]:pl-[1.35em] [&_ol]:my-[0.35em] [&_ol]:pl-[1.35em] [&_li]:my-[0.15em] [&_pre]:my-[0.4em] [&_pre]:overflow-x-hidden [&_pre]:break-words [&_pre]:whitespace-pre-wrap [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border-soft [&_pre]:bg-black/35 [&_pre]:px-2.5 [&_pre]:py-2 [&_pre]:text-[0.88em] [&_pre]:leading-snug [&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit [&_blockquote]:my-[0.35em] [&_blockquote]:border-l-[3px] [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_p>code]:rounded [&_p>code]:bg-white/12 [&_p>code]:px-1.5 [&_p>code]:py-px [&_p>code]:font-mono [&_p>code]:text-[0.9em]";

const chatMarkdownComponents: Components = {
  a: ({ href, children, ...props }) => (
    <a
      {...props}
      className="text-[color:var(--accent,#8ab4ff)] underline decoration-solid underline-offset-2 hover:brightness-110"
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
      className={cn(
        "mx-0.5 inline-flex cursor-pointer select-none items-center gap-1 rounded-md border border-border bg-white/[0.08] px-1.5 py-px align-middle text-[0.68rem] leading-relaxed text-foreground transition-[background-color,color,border-color] duration-100 hover:border-border hover:bg-white/[0.12] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/35",
      )}
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
      <FileText size={10} className="shrink-0 text-muted" strokeWidth={2.5} aria-hidden />
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
        <span key={i} className="contents">
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
  if (role === "ASSISTANT" && content.trim() === "") {
    return null;
  }

  return (
    <div className={cn("mb-2 flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] break-words p-2 text-[0.82rem] leading-normal text-foreground",
          mdBubbleProse,
          isUser
            ? "rounded-xl rounded-br-sm border border-[rgba(102,82,161,0.22)] bg-[rgba(167,139,250,0.2)]"
            : "rounded-xl rounded-bl-sm border border-border-soft bg-white/10",
        )}
      >
        {refs.length > 0 ? (
          <div
            className="mb-2.5 flex flex-wrap items-center gap-2 last:mb-0"
            aria-label="Referenced notes"
          >
            {refs.map((part, i) => (
              <NoteChip key={`ref-${part.documentId}-${i}`} part={part} onNoteClick={onNoteClick} />
            ))}
          </div>
        ) : null}
        {refs.length > 0 && hasRenderableBody(body) ? (
          <div className="min-w-0 leading-normal">{renderContentParts(body, onNoteClick)}</div>
        ) : refs.length === 0 ? (
          renderContentParts(parts, onNoteClick)
        ) : null}
      </div>
    </div>
  );
}
