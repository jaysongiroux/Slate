import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, MessageSquare, Send } from "lucide-react";
import type { JiraComment } from "@slate/shared";
import { addJiraComment } from "../../lib/api";
import { Button } from "../ui/button";
import { formatJiraError } from "./jira-errors";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function CommentSection({
  comments: initialComments,
  instanceId,
  issueKey,
}: {
  comments: JiraComment[];
  instanceId: string;
  issueKey: string;
}) {
  const [comments, setComments] = useState(initialComments);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setComments(initialComments);
  }, [initialComments]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      const result = await addJiraComment({ instanceId, issueKey, body: body.trim() });
      setComments((prev) => [...prev, result]);
      setBody("");
    } catch (err) {
      toast.error(formatJiraError(err, "Failed to add comment."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="overflow-hidden">
      <div className="flex items-center gap-2 text-[0.85rem] font-medium text-foreground">
        <MessageSquare size={14} />
        Comments ({comments.length})
      </div>
      <div className="mt-3 flex flex-col gap-3 overflow-hidden">
        {comments.map((c) => (
          <div key={c.id} className="overflow-hidden rounded-lg bg-white/[0.02] px-3 py-2.5">
            <div className="flex items-center gap-2">
              {c.author?.avatarUrl && (
                <img src={c.author.avatarUrl} alt="" className="size-5 rounded-full" />
              )}
              <span className="text-[0.82rem] font-medium text-foreground">
                {c.author?.displayName ?? "Unknown"}
              </span>
              <span className="text-[0.72rem] text-faint">{formatDate(c.created)}</span>
            </div>
            {c.bodyHtml ? (
              <div
                className="adf-content mt-1 box-border w-full min-w-0 overflow-hidden break-words text-[0.82rem] leading-relaxed text-muted"
                dangerouslySetInnerHTML={{ __html: c.bodyHtml }}
              />
            ) : (
              <div className="mt-1 overflow-hidden break-words whitespace-pre-wrap text-[0.82rem] leading-relaxed text-muted">
                {c.body}
              </div>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="mt-3 flex gap-2 overflow-hidden">
        <input
          type="text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment..."
          className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[0.82rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
          disabled={submitting}
        />
        <Button type="submit" size="sm" disabled={submitting || !body.trim()} className="shrink-0">
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </Button>
      </form>
    </div>
  );
}
