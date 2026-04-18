import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";

export function InlineTextField({
  value,
  onSave,
  className,
  inputClassName,
  multiline,
  placeholder,
}: {
  value: string;
  onSave: (value: string) => Promise<void>;
  className?: string;
  inputClassName?: string;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      if (!multiline) (inputRef.current as HTMLInputElement)?.select();
    }
  }, [editing, multiline]);

  async function handleSave() {
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft); setEditing(false); }
    catch { setDraft(value); setEditing(false); }
    finally { setSaving(false); }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setDraft(value); setEditing(false); }
    if (e.key === "Enter" && !multiline) { e.preventDefault(); void handleSave(); }
    if (e.key === "Enter" && multiline && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleSave(); }
  }

  const sharedClass = cn(
    "w-full box-border rounded-md border border-white/[0.12] bg-white/[0.04] px-2.5 py-1.5 text-foreground outline-none focus:border-white/[0.2]",
    inputClassName,
  );

  if (editing) {
    return multiline ? (
      <textarea
        ref={inputRef as any}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void handleSave()}
        onKeyDown={handleKeyDown}
        className={cn(sharedClass, "min-h-[80px] resize-y text-[0.85rem]")}
        disabled={saving}
      />
    ) : (
      <input
        ref={inputRef as any}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void handleSave()}
        onKeyDown={handleKeyDown}
        className={cn(sharedClass, "text-[0.85rem]")}
        disabled={saving}
      />
    );
  }

  return (
    <div
      className={cn(
        "min-h-[28px] cursor-pointer overflow-hidden break-words rounded-md px-2.5 py-1.5 transition-colors hover:bg-white/[0.04]",
        className,
      )}
      onClick={() => setEditing(true)}
    >
      {value || <span className="text-faint">{placeholder ?? "Click to edit"}</span>}
    </div>
  );
}
