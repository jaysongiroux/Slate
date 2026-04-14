import { parseMarkdownForTiptapPaste } from "@slate/shared";
import type { MarkdownImportNotePayload } from "../lib/api/ipc-core";
import type { SlateDatabase } from "./database";

export async function insertImportedMarkdownNotes(
  db: SlateDatabase,
  notes: MarkdownImportNotePayload[],
): Promise<void> {
  const now = new Date().toISOString();
  for (const n of notes) {
    const blocks = parseMarkdownForTiptapPaste(n.markdown);
    const content = {
      type: "doc" as const,
      content: blocks.length > 0 ? blocks : [{ type: "paragraph" }],
    };
    await db.notes.insert({
      id: n.id,
      path: n.path,
      title: n.title,
      content,
      markdown: n.markdown,
      pinned: false,
      isDeleted: false,
      isTemplate: n.isTemplate,
      updatedAt: now,
      createdAt: now,
    });
  }
}
