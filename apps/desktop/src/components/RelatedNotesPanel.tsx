import { useMemo } from "react";
import { FileText, PanelRightOpen } from "lucide-react";
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
 * Notes most related to the one being edited, derived from the already-loaded
 * note-graph payload (no extra fetch).
 *
 * Layout adapts to the editor pane width via container queries (the wrapper is
 * the `@container`):
 *  - Wide (>=1000px): docked in-flow beside the editor — there's room, so it
 *    doesn't squish the text column.
 *  - Narrow (<1000px): collapses to a floating trigger that reveals the list as
 *    a hover/focus overlay, so it never steals width from the editor.
 */
export function RelatedNotesPanel({
  payload,
  currentNoteId,
  onSelectNote,
}: RelatedNotesPanelProps) {
  const related = useMemo<RelatedNote[]>(
    () => relatedNotesFor(payload, currentNoteId),
    [payload, currentNoteId],
  );

  return (
    // Narrow: zero-width so it adds no layout; docked: a real 14rem column.
    // `sticky` keeps it in view while scrolling; non-static so it anchors the
    // floating children in narrow mode.
    <aside className="sticky top-[18px] z-10 w-0 self-start @min-[1000px]:w-56">
      <div className="group">
        {/* Collapsed trigger — only shown in narrow mode; sits behind the card
            (lower z) so revealing the overlay covers it without a display flip. */}
        <button
          type="button"
          title="Related notes"
          aria-label="Show related notes"
          className="absolute right-0 top-0 z-10 inline-flex size-7 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04] text-muted transition-colors hover:bg-white/[0.08] hover:text-foreground @min-[1000px]:hidden"
        >
          <PanelRightOpen size={15} />
        </button>

        {/* The card. Narrow: absolute overlay, hidden until hover/focus.
            Docked: static, always visible, lighter chrome. */}
        <div
          className="absolute right-0 top-0 z-20 hidden w-56 flex-col gap-2 rounded-[14px] border border-white/[0.08] bg-[rgba(20,22,26,0.94)] p-3 shadow-[0_16px_42px_rgba(0,0,0,0.4)] backdrop-blur-md group-hover:flex group-focus-within:flex @min-[1000px]:static @min-[1000px]:inset-auto @min-[1000px]:flex @min-[1000px]:bg-white/[0.03] @min-[1000px]:shadow-none @min-[1000px]:backdrop-blur-none"
        >
          <span className="text-[0.72rem] font-medium uppercase tracking-wide text-muted/80">
            Related notes
          </span>

          {related.length === 0 ? (
            <p className="text-[0.8rem] leading-snug text-muted/70">No related notes yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {related.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => onSelectNote(note.id)}
                    className="group/item flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
                  >
                    <FileText size={13} className="mt-0.5 shrink-0 text-muted/60" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[0.84rem] text-foreground/90 group-hover/item:text-foreground">
                        {note.title || "Untitled"}
                      </span>
                      {note.preview ? (
                        <span className="truncate text-[0.72rem] text-muted/60">
                          {note.preview}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
