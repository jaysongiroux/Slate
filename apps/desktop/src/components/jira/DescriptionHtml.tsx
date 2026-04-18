import { useEffect, useRef, useState } from "react";

export function DescriptionHtml({ html, plainText, onSave }: {
  html: string;
  plainText: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(plainText);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(plainText); }, [plainText]);
  useEffect(() => { if (editing) textareaRef.current?.focus(); }, [editing]);

  async function handleSave() {
    if (draft === plainText) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft); setEditing(false); }
    catch { setDraft(plainText); setEditing(false); }
    finally { setSaving(false); }
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void handleSave()}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setDraft(plainText); setEditing(false); }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleSave(); }
        }}
        className="w-full box-border rounded-md border border-white/[0.12] bg-white/[0.04] px-2.5 py-1.5 text-[0.85rem] text-foreground outline-none focus:border-white/[0.2] min-h-[80px] resize-y"
        disabled={saving}
      />
    );
  }

  return (
    <div
      className="adf-content box-border min-h-[40px] w-full min-w-0 cursor-pointer overflow-hidden break-words rounded-md px-2.5 py-1.5 text-[0.85rem] leading-relaxed text-foreground/70 transition-colors hover:bg-white/[0.04]"
      onClick={() => setEditing(true)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
