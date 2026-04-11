import { useState, useEffect } from "react";
import type { NoteDocType } from "../db/schemas/note.schema";
import type { SlateDatabase } from "../db/database";
import { TEMPLATE_LIBRARY_NOTE_SELECTOR } from "../db/template-library";

export function useNotes(db: SlateDatabase | null) {
  const [notes, setNotes] = useState<NoteDocType[]>([]);

  useEffect(() => {
    if (!db) return;

    const sub = db.notes
      .find({
        selector: { isDeleted: false },
        sort: [{ updatedAt: "desc" }],
      })
      .$.subscribe((docs) => {
        setNotes(docs.map((d) => d.toJSON()));
      });

    return () => sub.unsubscribe();
  }, [db]);

  return notes;
}

export function useNote(db: SlateDatabase | null, noteId: string | null) {
  const [note, setNote] = useState<NoteDocType | null>(null);

  useEffect(() => {
    if (!db || !noteId) {
      setNote(null);
      return;
    }

    const sub = db.notes.findOne({ selector: { id: noteId } }).$.subscribe((doc) => {
      setNote(doc ? doc.toJSON() : null);
    });

    return () => sub.unsubscribe();
  }, [db, noteId]);

  return note;
}

export function useTemplates(db: SlateDatabase | null) {
  const [templates, setTemplates] = useState<NoteDocType[]>([]);

  useEffect(() => {
    if (!db) return;

    const sub = db.notes
      .find({
        selector: TEMPLATE_LIBRARY_NOTE_SELECTOR,
        sort: [{ updatedAt: "desc" }],
      })
      .$.subscribe((docs) => {
        setTemplates(docs.map((d) => d.toJSON()));
      });

    return () => sub.unsubscribe();
  }, [db]);

  return templates;
}
