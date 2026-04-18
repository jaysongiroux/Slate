import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { JiraFieldMeta, JiraIssueType, JiraPriority, JiraUser } from "@slate/shared";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  createJiraIssue,
  getJiraCreateFieldsMeta,
  getJiraIssueTypes,
  getJiraLabels,
  getJiraPriorities,
  searchJiraUsers,
} from "../../lib/api";
import { DynamicField } from "./DynamicField";
import { formatJiraError } from "./jira-errors";

// ---------------------------------------------------------------------------
// Label multi-select
// ---------------------------------------------------------------------------

function LabelMultiSelect({
  selected,
  onChange,
  allLabels,
  loading,
}: {
  selected: string[];
  onChange: (labels: string[]) => void;
  allLabels: string[];
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const filtered = allLabels.filter(
    (l) => !selected.includes(l) && l.toLowerCase().includes(query.toLowerCase()),
  );
  const trimmed = query.trim();
  const showCreate = trimmed && !allLabels.some((l) => l.toLowerCase() === trimmed.toLowerCase()) && !selected.includes(trimmed);

  function addLabel(label: string) {
    onChange([...selected, label]);
    setQuery("");
    inputRef.current?.focus();
  }

  function removeLabel(label: string) {
    onChange(selected.filter((l) => l !== label));
  }

  return (
    <div className="relative" ref={ref}>
      <div
        className="flex min-h-[34px] cursor-text flex-wrap items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1"
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        {selected.map((label) => (
          <span
            key={label}
            className="flex items-center gap-1 rounded-full bg-white/[0.08] px-2 py-0.5 text-[0.75rem] text-muted"
          >
            {label}
            <button
              type="button"
              className="inline-flex cursor-pointer items-center border-0 bg-transparent p-0 text-faint hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); removeLabel(label); }}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !query && selected.length > 0) {
              removeLabel(selected[selected.length - 1]);
            }
            if (e.key === "Enter" && trimmed) {
              e.preventDefault();
              if (showCreate) addLabel(trimmed);
              else if (filtered.length > 0) addLabel(filtered[0]);
            }
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={selected.length === 0 ? "Search or create labels..." : ""}
          className="min-w-[80px] flex-1 border-0 bg-transparent py-0.5 text-[0.82rem] text-foreground outline-none placeholder:text-faint"
        />
      </div>
      {open && (filtered.length > 0 || showCreate || loading) && (
        <div className="absolute top-full left-0 z-20 mt-1 max-h-[180px] w-full overflow-y-auto rounded-lg border border-white/[0.08] bg-[#1c1c1e] py-1 shadow-xl" style={{ scrollbarWidth: "none" }}>
          {loading ? (
            <div className="flex justify-center py-2"><Loader2 size={14} className="animate-spin text-faint" /></div>
          ) : (
            <>
              {filtered.slice(0, 30).map((label) => (
                <button
                  key={label}
                  type="button"
                  className="flex w-full cursor-pointer items-center border-0 bg-transparent px-3 py-1.5 text-left text-[0.82rem] text-muted hover:bg-white/[0.06] hover:text-foreground"
                  onClick={() => addLabel(label)}
                >
                  {label}
                </button>
              ))}
              {showCreate && (
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-3 py-1.5 text-left text-[0.82rem] text-blue-300 hover:bg-white/[0.06]"
                  onClick={() => addLabel(trimmed)}
                >
                  Create &ldquo;{trimmed}&rdquo;
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateIssueDialog
// ---------------------------------------------------------------------------

interface CreateIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: string;
  projectKey: string;
  onCreated: (issueKey: string) => void;
}

export function CreateIssueDialog({
  open,
  onOpenChange,
  instanceId,
  projectKey,
  onCreated,
}: CreateIssueDialogProps) {
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [issueTypeId, setIssueTypeId] = useState("");
  const [priorityId, setPriorityId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [issueTypes, setIssueTypes] = useState<JiraIssueType[]>([]);
  const [priorities, setPriorities] = useState<JiraPriority[]>([]);
  const [allLabels, setAllLabels] = useState<string[]>([]);
  const [issueTypesLoading, setIssueTypesLoading] = useState(false);
  const [prioritiesLoading, setPrioritiesLoading] = useState(false);
  const [labelsLoading, setLabelsLoading] = useState(false);

  // Custom required fields
  const [customFieldsMeta, setCustomFieldsMeta] = useState<JiraFieldMeta[]>([]);
  const [customFieldsLoading, setCustomFieldsLoading] = useState(false);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});

  // Assignee search
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [assigneeResults, setAssigneeResults] = useState<JiraUser[]>([]);
  const [assigneeLoading, setAssigneeLoading] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [selectedAssigneeName, setSelectedAssigneeName] = useState("");
  const assigneeDebounce = useRef<number>(0);
  const assigneeRef = useRef<HTMLDivElement>(null);

  // Load metadata when dialog opens
  useEffect(() => {
    if (!open) return;
    setSummary("");
    setDescription("");
    setIssueTypeId("");
    setPriorityId("");
    setAssigneeId("");
    setSelectedAssigneeName("");
    setAssigneeQuery("");
    setSelectedLabels([]);
    setCustomFieldsMeta([]);
    setCustomFieldValues({});
    setError("");

    setIssueTypesLoading(true);
    setPrioritiesLoading(true);
    setLabelsLoading(true);

    void getJiraIssueTypes({ instanceId, projectKey })
      .then((r) => {
        setIssueTypes(r.issueTypes);
        const defaultType = r.issueTypes.find((t) => !t.subtask);
        if (defaultType) setIssueTypeId(defaultType.id);
      })
      .catch(() => setIssueTypes([]))
      .finally(() => setIssueTypesLoading(false));

    void getJiraPriorities({ instanceId })
      .then((r) => setPriorities(r.priorities))
      .catch(() => setPriorities([]))
      .finally(() => setPrioritiesLoading(false));

    void getJiraLabels({ instanceId })
      .then((r) => setAllLabels(r.labels))
      .catch(() => setAllLabels([]))
      .finally(() => setLabelsLoading(false));
  }, [open, instanceId, projectKey]);

  // Fetch custom required fields when issue type changes
  useEffect(() => {
    if (!open || !issueTypeId) { setCustomFieldsMeta([]); return; }
    setCustomFieldsLoading(true);
    setCustomFieldValues({});
    void getJiraCreateFieldsMeta({ instanceId, projectKey, issueTypeId })
      .then((r) => {
        setCustomFieldsMeta(r.fields);
        // Pre-fill defaults
        const defaults: Record<string, unknown> = {};
        for (const f of r.fields) {
          if (f.defaultValue !== undefined) defaults[f.fieldId] = f.defaultValue;
        }
        if (Object.keys(defaults).length > 0) setCustomFieldValues(defaults);
      })
      .catch(() => setCustomFieldsMeta([]))
      .finally(() => setCustomFieldsLoading(false));
  }, [open, issueTypeId, instanceId, projectKey]);

  // Assignee search debounce
  useEffect(() => {
    if (!assigneeOpen) return;
    if (assigneeDebounce.current) clearTimeout(assigneeDebounce.current);
    assigneeDebounce.current = window.setTimeout(() => {
      setAssigneeLoading(true);
      void searchJiraUsers({ instanceId, query: assigneeQuery })
        .then((r) => setAssigneeResults(r.users))
        .catch(() => setAssigneeResults([]))
        .finally(() => setAssigneeLoading(false));
    }, 200);
  }, [assigneeOpen, assigneeQuery, instanceId]);

  // Close assignee dropdown on outside click
  useEffect(() => {
    if (!assigneeOpen) return;
    const h = (e: MouseEvent) => {
      if (assigneeRef.current && !assigneeRef.current.contains(e.target as Node)) setAssigneeOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [assigneeOpen]);

  async function handleCreate() {
    if (!summary.trim() || !issueTypeId) return;
    setSaving(true);
    setError("");
    try {
      // Build custom fields payload
      const customFields: Record<string, unknown> = {};
      for (const f of customFieldsMeta) {
        const val = customFieldValues[f.fieldId];
        if (val !== undefined && val !== null && val !== "") customFields[f.fieldId] = val;
      }

      const result = await createJiraIssue({
        instanceId,
        fields: {
          projectKey,
          issueTypeId,
          summary: summary.trim(),
          description: description.trim() || undefined,
          assigneeId: assigneeId || undefined,
          priorityId: priorityId || undefined,
          labels: selectedLabels.length > 0 ? selectedLabels : undefined,
          customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
        },
      });
      onOpenChange(false);
      onCreated(result.issue.key);
    } catch (err) {
      setError(formatJiraError(err, "Failed to create issue."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Issue — {projectKey}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          {/* Issue Type */}
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Issue Type</label>
            {issueTypesLoading ? (
              <div className="flex items-center gap-2 py-1.5 text-[0.82rem] text-faint">
                <Loader2 size={12} className="animate-spin" /> Loading...
              </div>
            ) : (
              <select
                value={issueTypeId}
                onChange={(e) => setIssueTypeId(e.target.value)}
                className="appearance-none rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none focus:border-white/[0.15]"
              >
                {issueTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Summary */}
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Summary</label>
            <input
              type="text"
              placeholder="Issue summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && summary.trim() && issueTypeId) void handleCreate();
              }}
            />
          </div>

          {/* Description */}
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Description</label>
            <textarea
              placeholder="Optional description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[60px] resize-y rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
              style={{ boxSizing: "border-box" }}
            />
          </div>

          {/* Assignee */}
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Assignee</label>
            <div className="relative" ref={assigneeRef}>
              <button
                type="button"
                className="w-full cursor-pointer rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-left text-[0.85rem] text-foreground outline-none hover:border-white/[0.12]"
                onClick={() => setAssigneeOpen(!assigneeOpen)}
              >
                {selectedAssigneeName || <span className="text-faint">Unassigned</span>}
              </button>
              {assigneeOpen && (
                <div className="absolute top-full left-0 z-20 mt-1 w-full rounded-lg border border-white/[0.08] bg-[#1c1c1e] shadow-xl">
                  <div className="border-b border-white/[0.06] p-2">
                    <input
                      type="text"
                      placeholder="Search users..."
                      value={assigneeQuery}
                      onChange={(e) => setAssigneeQuery(e.target.value)}
                      className="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[0.82rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-[200px] overflow-y-auto py-1" style={{ scrollbarWidth: "none" }}>
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-[0.82rem] text-faint hover:bg-white/[0.06]"
                      onClick={() => { setAssigneeId(""); setSelectedAssigneeName(""); setAssigneeOpen(false); }}
                    >
                      Unassigned
                    </button>
                    {assigneeLoading ? (
                      <div className="flex justify-center py-2"><Loader2 size={14} className="animate-spin text-faint" /></div>
                    ) : (
                      assigneeResults.map((u) => (
                        <button
                          key={u.accountId}
                          type="button"
                          className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-[0.82rem] text-muted hover:bg-white/[0.06] hover:text-foreground"
                          onClick={() => { setAssigneeId(u.accountId); setSelectedAssigneeName(u.displayName); setAssigneeOpen(false); }}
                        >
                          {u.avatarUrl && <img src={u.avatarUrl} alt="" className="size-5 rounded-full" />}
                          <span className="truncate">{u.displayName}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Priority */}
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Priority</label>
            {prioritiesLoading ? (
              <div className="flex items-center gap-2 py-1.5 text-[0.82rem] text-faint">
                <Loader2 size={12} className="animate-spin" /> Loading...
              </div>
            ) : (
              <select
                value={priorityId}
                onChange={(e) => setPriorityId(e.target.value)}
                className="appearance-none rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none focus:border-white/[0.15]"
              >
                <option value="">Default</option>
                {priorities.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Labels */}
          <div className="grid gap-1">
            <label className="text-[0.78rem] text-muted">Labels</label>
            <LabelMultiSelect
              selected={selectedLabels}
              onChange={setSelectedLabels}
              allLabels={allLabels}
              loading={labelsLoading}
            />
          </div>

          {/* Custom fields */}
          {customFieldsLoading ? (
            <div className="flex items-center gap-2 py-1.5 text-[0.82rem] text-faint">
              <Loader2 size={12} className="animate-spin" /> Loading fields...
            </div>
          ) : customFieldsMeta.length > 0 ? (
            <>
              <div className="border-t border-white/[0.06] pt-2 text-[0.72rem] font-medium uppercase tracking-wider text-faint">
                Additional Fields
              </div>
              {customFieldsMeta.map((f) => (
                <div key={f.fieldId} className="grid gap-1">
                  <label className="text-[0.78rem] text-muted">
                    {f.name} {f.required && <span className="text-red-400">*</span>}
                  </label>
                  <DynamicField
                    field={f}
                    value={customFieldValues[f.fieldId]}
                    onChange={(val) => setCustomFieldValues((prev) => ({ ...prev, [f.fieldId]: val }))}
                  />
                </div>
              ))}
            </>
          ) : null}

          {error && <p className="m-0 text-[0.78rem] leading-snug text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleCreate()}
              disabled={saving || !summary.trim() || !issueTypeId}
            >
              {saving ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
