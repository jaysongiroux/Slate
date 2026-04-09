import { extractTiptapContentFromYDoc } from "@slate/shared";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

export async function loadTemplateTiptapContent(noteId: string): Promise<any[]> {
  if (!noteId.trim() || typeof indexedDB === "undefined") {
    return [];
  }

  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(`slate-${noteId}`, ydoc);

  try {
    await persistence.whenSynced;
    return extractTiptapContentFromYDoc(ydoc);
  } finally {
    ydoc.destroy();
  }
}
