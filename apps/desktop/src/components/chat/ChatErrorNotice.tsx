import { useState } from "react";
import { ChevronRight, ExternalLink, RotateCcw, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/utils";
import { openExternal } from "../../lib/api";

export interface ChatErrorNoticeProps {
  /** Short headline, e.g. "Out of API credits". */
  title?: string;
  /** Plain-language explanation plus the next step. */
  message: string;
  /** Raw provider text, hidden behind a disclosure. */
  detail?: string;
  /** Page that fixes the problem, when there is one. */
  actionUrl?: string;
  retryable?: boolean;
  onRetry?: () => void;
}

function actionLabel(url: string): string {
  return /billing/i.test(url) ? "Open billing" : "Open provider settings";
}

/**
 * A failed chat turn, rendered in place of the reply that never arrived. Persisted
 * with the conversation, so it reads the same live and after a reload.
 */
export function ChatErrorNotice({
  title,
  message,
  detail,
  actionUrl,
  retryable,
  onRetry,
}: ChatErrorNoticeProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const showActions = Boolean(actionUrl) || Boolean(retryable && onRetry);

  return (
    <div
      className="mb-2 rounded-lg border border-[rgba(255,156,148,0.2)] bg-[rgba(255,156,148,0.08)] px-2.5 py-2 text-[0.78rem] leading-snug"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-[2px] size-3.5 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          {title ? <div className="font-semibold text-danger">{title}</div> : null}
          <div className="text-foreground/85">{message}</div>

          {showActions ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {actionUrl ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-border-soft bg-white/[0.06] px-2 py-1 text-[0.72rem] text-foreground transition-colors hover:bg-white/[0.12]"
                  onClick={() => void openExternal(actionUrl)}
                >
                  <ExternalLink className="size-3" aria-hidden />
                  {actionLabel(actionUrl)}
                </button>
              ) : null}
              {retryable && onRetry ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-border-soft bg-white/[0.06] px-2 py-1 text-[0.72rem] text-foreground transition-colors hover:bg-white/[0.12]"
                  onClick={onRetry}
                >
                  <RotateCcw className="size-3" aria-hidden />
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}

          {detail ? (
            <div className="mt-1.5">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[0.72rem] text-muted transition-colors hover:text-foreground"
                onClick={() => setDetailOpen((open) => !open)}
                aria-expanded={detailOpen}
              >
                <ChevronRight
                  className={cn("size-3 transition-transform", detailOpen && "rotate-90")}
                  aria-hidden
                />
                Technical details
              </button>
              {detailOpen ? (
                <pre className="mt-1 max-h-[160px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-soft bg-black/20 p-2 text-[0.68rem] leading-snug text-muted">
                  {detail}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
