import { getDatabase } from "../db/database";

export async function loadTemplateTiptapContent(noteId: string): Promise<any[]> {
  if (!noteId.trim()) {
    return [];
  }

  const db = await getDatabase();
  const doc = await db.notes.findOne({ selector: { id: noteId } }).exec();

  if (!doc || !doc.content) {
    return [];
  }

  const content = doc.content as { content?: any[] };
  return Array.isArray(content.content) ? content.content : [];
}
