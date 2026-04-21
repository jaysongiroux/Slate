import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { JiraFieldMeta, JiraIssue } from "@slate/shared";
import { cn } from "../../lib/utils";
import { CustomFieldRow } from "./CustomFieldRow";

export function CustomFieldsAccordion({
  fields,
  issue,
  instanceId,
  onSaved,
}: {
  fields: JiraFieldMeta[];
  issue: JiraIssue;
  instanceId: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="w-full min-w-0 overflow-hidden">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight
          size={14}
          className={cn(
            "shrink-0 text-faint transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        <span className="text-[0.72rem] font-medium uppercase tracking-wider text-faint">
          Additional Fields ({fields.length})
        </span>
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-w-0 overflow-hidden">
          <div className="flex w-full min-w-0 flex-col gap-3 pt-2">
            {fields.map((f) => (
              <CustomFieldRow
                key={f.fieldId}
                field={f}
                value={issue.customFields[f.fieldId]}
                instanceId={instanceId}
                issueKey={issue.key}
                onSaved={onSaved}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
