import { useMemo, useState } from "react";
import { FileText, PanelRightClose, PanelRightOpen } from "lucide-react";
import { relatedNotesFor } from "../lib/related-notes.mjs";
import type { NoteGraphPayload } from "../lib/api/graph-api";

interface RelatedNote {
  id: string;
  title: string;
  preview: string;
  score: number;
}

interface RelatedNotesPanelProps {
  payload: NoteGraphPayload | null;
  currentNoteId: string;
  onSelectNote: (noteId: string) => void;
}

/**
 * Collapsible sidebar listing the notes most related to the one being edited.
 * Derived entirely from the already-loaded note-graph payload — no extra fetch.
 */
export function RelatedNotesPanel({
  payload,
  currentNoteId,
  onSelectNote,
}: RelatedNotesPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const related = useMemo<RelatedNote[]>(
    () => relatedNotesFor(payload, currentNoteId),
    [payload, currentNoteId],
  );

  if (collapsed) {
    return (
      <aside className="sticky top-[18px] self-start">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Show related notes"
          aria-label="Show related notes"
          className="inline-flex size-7 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04] text-muted transition-colors hover:bg-white/[0.08] hover:text-foreground"
        >
          <PanelRightOpen size={15} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="sticky top-[18px] flex w-56 shrink-0 flex-col gap-2 self-start rounded-[14px] border border-white/[0.08] bg-white/[0.03] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[0.72rem] font-medium uppercase tracking-wide text-muted/80">
          Related notes
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="Hide related notes"
          aria-label="Hide related notes"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/[0.08] hover:text-foreground"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      {related.length === 0 ? (
        <p className="text-[0.8rem] leading-snug text-muted/70">No related notes yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {related.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                onClick={() => onSelectNote(note.id)}
                className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
              >
                <FileText size={13} className="mt-0.5 shrink-0 text-muted/60" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[0.84rem] text-foreground/90 group-hover:text-foreground">
                    {note.title || "Untitled"}
                  </span>
                  {note.preview ? (
                    <span className="truncate text-[0.72rem] text-muted/60">{note.preview}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
