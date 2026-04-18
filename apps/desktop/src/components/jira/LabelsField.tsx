import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import type { JiraIssue } from "@slate/shared";
import { getJiraLabels, updateJiraIssue } from "../../lib/api";
import { formatJiraError } from "./jira-errors";

export function LabelsField({ issue, instanceId, onSaved }: {
  issue: JiraIssue;
  instanceId: string;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(issue.labels);
  const [allLabels, setAllLabels] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setSelected(issue.labels); }, [issue.labels]);

  // Fetch labels when dropdown opens for the first time
  useEffect(() => {
    if (!open || allLabels.length > 0) return;
    void getJiraLabels({ instanceId })
      .then((r) => setAllLabels(r.labels))
      .catch(() => setAllLabels([]));
  }, [open, instanceId, allLabels.length]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  async function save(labels: string[]) {
    setSelected(labels);
    try {
      await updateJiraIssue({ instanceId, issueKey: issue.key, fields: { labels } });
      onSaved();
    } catch (err) {
      toast.error(formatJiraError(err, "Failed to update labels."));
      setSelected(issue.labels);
    }
  }

  function addLabel(label: string) {
    if (selected.includes(label)) return;
    void save([...selected, label]);
    setQuery("");
    inputRef.current?.focus();
  }

  function removeLabel(label: string) {
    void save(selected.filter((l) => l !== label));
  }

  const filtered = allLabels.filter(
    (l) => !selected.includes(l) && l.toLowerCase().includes(query.toLowerCase()),
  );
  const trimmed = query.trim();
  const showCreate = trimmed
    && !allLabels.some((l) => l.toLowerCase() === trimmed.toLowerCase())
    && !selected.includes(trimmed);

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
      {open && (filtered.length > 0 || showCreate) && (
        <div className="absolute top-full left-0 z-20 mt-1 max-h-[180px] w-full overflow-y-auto rounded-lg border border-white/[0.08] bg-[#1c1c1e] py-1 shadow-xl [scrollbar-width:none]">
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
        </div>
      )}
    </div>
  );
}
