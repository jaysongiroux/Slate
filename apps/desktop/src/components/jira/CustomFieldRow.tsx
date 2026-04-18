import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { JiraFieldMeta } from "@slate/shared";
import { updateJiraIssue } from "../../lib/api";
import { Button } from "../ui/button";
import { DynamicField } from "./DynamicField";
import { formatJiraError } from "./jira-errors";

export function CustomFieldRow({ field, value, instanceId, issueKey, onSaved }: {
  field: JiraFieldMeta;
  value: unknown;
  instanceId: string;
  issueKey: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<unknown>(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  async function handleSave() {
    setEditing(false);
    if (JSON.stringify(draft) === JSON.stringify(value)) return;
    setSaving(true);
    try {
      await updateJiraIssue({ instanceId, issueKey, fields: { customFields: { [field.fieldId]: draft } } });
      onSaved();
    } catch (err) {
      toast.error(formatJiraError(err, `Failed to update ${field.name}.`));
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }

  function displayValue(): string {
    if (value == null) return "None";
    if (typeof value === "string") return value || "None";
    if (typeof value === "number") return String(value);
    if (Array.isArray(value)) {
      return value.map((v: any) => v?.name ?? v?.value ?? v?.id ?? String(v)).join(", ") || "None";
    }
    if (typeof value === "object") {
      const obj = value as Record<string, any>;
      return obj.name ?? obj.value ?? obj.id ?? "None";
    }
    return String(value);
  }

  return (
    <div className="min-w-0 overflow-hidden">
      <span className="text-[0.72rem] font-medium uppercase tracking-wider text-faint">
        {field.name} {field.required && <span className="text-red-400">*</span>}
      </span>
      <div className="mt-0.5 min-w-0">
        {editing ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <DynamicField field={field} value={draft} onChange={setDraft} />
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setDraft(value); setEditing(false); }} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div
            className="min-h-[28px] cursor-pointer rounded-md px-2.5 py-1.5 text-[0.85rem] text-muted transition-colors hover:bg-white/[0.04]"
            onClick={() => setEditing(true)}
          >
            {displayValue()}
          </div>
        )}
      </div>
    </div>
  );
}
