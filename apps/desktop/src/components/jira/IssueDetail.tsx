import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { JiraComment, JiraFieldMeta, JiraIssue } from "@slate/shared";
import { getJiraIssue, getJiraCreateFieldsMeta, updateJiraIssue } from "../../lib/api";
import { useJiraStore } from "../../stores/jira-store";
import { useNavigationStore } from "../../stores/navigation-store";
import { ScrollArea } from "../ui/scroll-area";
import { InlineTextField } from "./InlineTextField";
import { DescriptionHtml } from "./DescriptionHtml";
import { StatusDropdown } from "./StatusDropdown";
import { AssigneePicker } from "./AssigneePicker";
import { PriorityPicker } from "./PriorityPicker";
import { LabelsField } from "./LabelsField";
import { CustomFieldsAccordion } from "./CustomFieldsAccordion";
import { CommentSection } from "./CommentSection";
import { IssueRefRow } from "./IssueRefRow";
import { formatJiraError } from "./jira-errors";
import "./issue-detail.css";

export function IssueDetail() {
  const selectedInstanceId = useJiraStore((s) => s.selectedInstanceId);
  const selectedIssueKey = useJiraStore((s) => s.selectedIssueKey);
  const setSelectedIssueKey = useJiraStore((s) => s.setSelectedIssueKey);
  const navPush = useNavigationStore((s) => s.push);
  const [issue, setIssue] = useState<JiraIssue | null>(null);
  const [comments, setComments] = useState<JiraComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customFieldsMeta, setCustomFieldsMeta] = useState<JiraFieldMeta[]>([]);

  const fetchIssue = useCallback(async (background = false) => {
    if (!selectedInstanceId || !selectedIssueKey) return;
    if (!background) { setLoading(true); setError(null); }
    try {
      const result = await getJiraIssue({ instanceId: selectedInstanceId, issueKey: selectedIssueKey });
      setIssue(result.issue);
      setComments(result.comments);
    } catch (err) {
      if (!background) setError(formatJiraError(err, "Failed to load issue."));
    } finally {
      if (!background) setLoading(false);
    }
  }, [selectedInstanceId, selectedIssueKey]);

  useEffect(() => { void fetchIssue(false); }, [fetchIssue]);

  useEffect(() => {
    if (!issue || !selectedInstanceId) { setCustomFieldsMeta([]); return; }
    const projectKey = issue.key.split("-")[0];
    void getJiraCreateFieldsMeta({ instanceId: selectedInstanceId, projectKey, issueTypeId: issue.issueType.id })
      .then((r) => setCustomFieldsMeta(r.fields))
      .catch(() => setCustomFieldsMeta([]));
  }, [issue?.key, issue?.issueType.id, selectedInstanceId]);

  function navigateToIssue(issueKey: string) {
    setSelectedIssueKey(issueKey);
    navPush({ type: "jira", issueKey });
  }

  const refresh = () => void fetchIssue(true);

  async function handleFieldSave(fields: { summary?: string; description?: string }) {
    if (!selectedInstanceId || !selectedIssueKey) return;
    try {
      await updateJiraIssue({ instanceId: selectedInstanceId, issueKey: selectedIssueKey, fields });
      refresh();
    } catch (err) {
      toast.error(formatJiraError(err, "Failed to update issue."));
      throw err;
    }
  }

  if (loading) {
    return <div className="flex min-h-0 flex-1 items-center justify-center"><Loader2 size={18} className="animate-spin text-faint" /></div>;
  }
  if (error) {
    return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center"><p className="m-0 text-[0.82rem] text-foreground/40">{error}</p></div>;
  }
  if (!issue || !selectedInstanceId) return null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-2 overflow-hidden border-b border-white/[0.04] px-4 py-2.5">
        {issue.issueType.iconUrl && <img src={issue.issueType.iconUrl} alt="" className="size-4 rounded-sm" />}
        <span className="text-[0.78rem] font-medium text-faint">{issue.key}</span>
      </div>

      <ScrollArea className="note-scroll-area min-h-0 min-w-0 flex-1 [&_.ui-scroll-area__viewport]:overflow-x-hidden! [&_.ui-scroll-area__scrollbar--horizontal]:hidden [&_.ui-scroll-area__scrollbar--vertical]:hidden">
        <div className="box-border w-full min-w-0 overflow-hidden px-6 py-5 pb-12">
          <div className="flex w-full min-w-0 flex-col gap-6 overflow-hidden">
            {/* Summary */}
            <InlineTextField
              value={issue.summary}
              onSave={(summary) => handleFieldSave({ summary })}
              className="text-[1.15rem] font-semibold text-foreground"
              inputClassName="text-[1.15rem] font-semibold"
              placeholder="Issue summary"
            />

            {/* Metadata row */}
            <div className="flex w-full min-w-0 flex-wrap gap-3 gap-x-6 overflow-hidden">
              <div className="flex flex-col gap-1">
                <span className="text-[0.72rem] font-medium uppercase tracking-wider text-faint">Status</span>
                <StatusDropdown issue={issue} instanceId={selectedInstanceId} onTransitioned={refresh} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[0.72rem] font-medium uppercase tracking-wider text-faint">Assignee</span>
                <AssigneePicker issue={issue} instanceId={selectedInstanceId} onSaved={refresh} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[0.72rem] font-medium uppercase tracking-wider text-faint">Priority</span>
                <PriorityPicker issue={issue} instanceId={selectedInstanceId} onSaved={refresh} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[0.72rem] font-medium uppercase tracking-wider text-faint">Reporter</span>
                <div className="flex items-center gap-2 px-2.5 py-1.5 text-[0.85rem] text-muted">
                  {issue.reporter?.avatarUrl && <img src={issue.reporter.avatarUrl} alt="" className="size-5 rounded-full" />}
                  <span>{issue.reporter?.displayName ?? "Unknown"}</span>
                </div>
              </div>
            </div>

            {/* Labels */}
            <div className="overflow-hidden">
              <span className="text-[0.72rem] font-medium uppercase tracking-wider text-faint">Labels</span>
              <div className="mt-1">
                <LabelsField issue={issue} instanceId={selectedInstanceId} onSaved={refresh} />
              </div>
            </div>

            {/* Custom fields */}
            {customFieldsMeta.length > 0 && (
              <CustomFieldsAccordion
                fields={customFieldsMeta}
                issue={issue}
                instanceId={selectedInstanceId}
                onSaved={refresh}
              />
            )}

            {/* Description */}
            <div className="overflow-hidden">
              <span className="text-[0.72rem] font-medium uppercase tracking-wider text-faint">Description</span>
              <div className="mt-1">
                {issue.descriptionHtml ? (
                  <DescriptionHtml
                    html={issue.descriptionHtml}
                    plainText={issue.description ?? ""}
                    onSave={(description) => handleFieldSave({ description })}
                  />
                ) : (
                  <InlineTextField
                    value={issue.description ?? ""}
                    onSave={(description) => handleFieldSave({ description })}
                    className="min-h-[40px] text-[0.85rem] leading-relaxed text-muted"
                    multiline
                    placeholder="No description"
                  />
                )}
              </div>
            </div>

            {/* Child issues (epics) */}
            {issue.children.length > 0 && (
              <div className="overflow-hidden">
                <span className="text-[0.72rem] font-medium uppercase tracking-wider text-faint">Child Issues ({issue.children.length})</span>
                <div className="mt-1 overflow-hidden">
                  {issue.children.map((child) => (
                    <IssueRefRow key={child.id} issueKey={child.key} summary={child.summary} statusName={child.status.name} statusCategory={child.status.statusCategory} onClick={() => navigateToIssue(child.key)} />
                  ))}
                </div>
              </div>
            )}

            {/* Subtasks */}
            {issue.subtasks.length > 0 && (
              <div className="overflow-hidden">
                <span className="text-[0.72rem] font-medium uppercase tracking-wider text-faint">Subtasks ({issue.subtasks.length})</span>
                <div className="mt-1 overflow-hidden">
                  {issue.subtasks.map((sub) => (
                    <IssueRefRow key={sub.id} issueKey={sub.key} summary={sub.summary} statusName={sub.status.name} statusCategory={sub.status.statusCategory} onClick={() => navigateToIssue(sub.key)} />
                  ))}
                </div>
              </div>
            )}

            {/* Dates */}
            <div className="overflow-hidden text-[0.78rem] text-faint">
              Created: {new Date(issue.created).toLocaleDateString()} &middot; Updated: {new Date(issue.updated).toLocaleDateString()}
            </div>

            {/* Comments */}
            <CommentSection comments={comments} instanceId={selectedInstanceId} issueKey={issue.key} />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
