import { useMemo } from "react";
import type { KeyboardEvent } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import { parseNoteLinkMarkdown, type NoteLinkMarkdownPart } from "../lib/noteLinkMarkdown";
import { Calendar, FileText } from "lucide-react";
import { cn } from "../lib/utils";
import { ChatErrorNotice } from "./chat/ChatErrorNotice";
import type { ChatMessageMetadata } from "./chat/chat-helpers";

type ChipPart = Extract<NoteLinkMarkdownPart, { kind: "chip" }>;
type CalendarChipPart = Extract<NoteLinkMarkdownPart, { kind: "calendar_chip" }>;

/** Leading note/calendar chips (ignoring whitespace-only text) vs rest of the message for layout. */
function splitLeadingRefs(parts: NoteLinkMarkdownPart[]): {
  refs: (ChipPart | CalendarChipPart)[];
  body: NoteLinkMarkdownPart[];
} {
  const refs: (ChipPart | CalendarChipPart)[] = [];
  let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (p.kind === "text" && /^\s*$/.test(p.value)) {
      i += 1;
      continue;
    }
    if (p.kind === "chip" || p.kind === "calendar_chip") {
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
    (p) =>
      p.kind === "chip" ||
      p.kind === "calendar_chip" ||
      (p.kind === "text" && p.value.trim() !== ""),
  );
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

function CalendarChip({ part }: { part: CalendarChipPart }) {
  return (
    <span
      className="mx-0.5 inline-flex select-none items-center gap-1 rounded-md border border-[rgba(96,165,250,0.25)] bg-[rgba(96,165,250,0.1)] px-1.5 py-px align-middle text-[0.68rem] leading-relaxed text-[rgba(147,197,253,0.98)]"
      title={`Calendar: ${part.title}`}
    >
      <Calendar size={10} className="shrink-0 opacity-70" strokeWidth={2.5} aria-hidden />
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
    if (part.kind === "calendar_chip") {
      return <CalendarChip key={i} part={part} />;
    }
    return <NoteChip key={i} part={part} onNoteClick={onNoteClick} />;
  });
}

export interface ChatMessageProps {
  role: "USER" | "ASSISTANT";
  content: string;
  metadata?: ChatMessageMetadata | null;
  onNoteClick?: (documentId: string) => void;
  /** Re-runs a failed turn; only offered for retryable error notices. */
  onRetry?: () => void;
}

export function ChatMessage({ role, content, metadata, onNoteClick, onRetry }: ChatMessageProps) {
  const isUser = role === "USER";
  const { parts, refs, body } = useMemo(() => {
    const parsed = parseNoteLinkMarkdown(content);
    const { refs, body } = splitLeadingRefs(parsed);
    return { parts: parsed, refs, body };
  }, [content]);
  if (role === "ASSISTANT" && content.trim() === "") {
    return null;
  }

  if (role === "ASSISTANT" && metadata?.kind === "error") {
    return (
      <ChatErrorNotice
        title={metadata.title}
        message={content}
        detail={metadata.detail}
        actionUrl={metadata.actionUrl}
        retryable={metadata.retryable}
        onRetry={onRetry}
      />
    );
  }

  if (role === "ASSISTANT" && metadata?.kind === "tool_call") {
    return (
      <div className="px-0 py-2 pb-1 text-[0.72rem] italic leading-snug text-muted">{content}</div>
    );
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
            aria-label="Referenced items"
          >
            {refs.map((part, i) =>
              part.kind === "calendar_chip" ? (
                <CalendarChip key={`ref-cal-${part.subscriptionId}-${i}`} part={part} />
              ) : (
                <NoteChip
                  key={`ref-${part.documentId}-${i}`}
                  part={part}
                  onNoteClick={onNoteClick}
                />
              ),
            )}
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
