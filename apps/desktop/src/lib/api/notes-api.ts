import type { LocalNoteSummary } from "@slate/shared";
import type { NoteDocType } from "../../db/schemas/note.schema";
import { getDatabase } from "../../db/database";
import { TEMPLATE_LIBRARY_NOTE_SELECTOR } from "../../db/template-library";
import { desktopApi } from "./ipc-core";

export { TEMPLATE_LIBRARY_NOTE_SELECTOR };

function noteDocToLocalSummary(doc: NoteDocType): LocalNoteSummary {
  return {
    id: doc.id,
    title: doc.title,
    path: doc.path,
    pinned: doc.pinned,
    isTemplate: doc.isTemplate,
    deleted: doc.isDeleted,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
  };
}

export function getSnapshot() {
  return desktopApi().getSnapshot();
}

export function createNote(parentPath?: string, name?: string) {
  return desktopApi().createNote(parentPath, name);
}

export function createDailyNote() {
  return desktopApi().createDailyNote();
}

export function createFolder(parentPath?: string, name?: string) {
  return desktopApi().createFolder(parentPath, name);
}

export async function listTemplates(): Promise<LocalNoteSummary[]> {
  const db = await getDatabase();
  const docs = await db.notes
    .find({
      selector: TEMPLATE_LIBRARY_NOTE_SELECTOR,
      sort: [{ updatedAt: "desc" }],
    })
    .exec();
  return docs.map((d) => noteDocToLocalSummary(d.toJSON()));
}

export function createTemplate(parentPath?: string, name?: string) {
  return desktopApi().createTemplate(parentPath, name);
}

export function readTemplateContent(relativePath: string) {
  return desktopApi().readTemplateContent(relativePath);
}

export function loadNote(noteId: string) {
  return desktopApi().loadNote(noteId);
}

export function getNoteCrdtState(noteId: string) {
  return desktopApi().getNoteCrdtState(noteId);
}

export function saveNote(payload: { id: string; title: string; markdown: string }) {
  return desktopApi().saveNote(payload);
}

export function deleteNote(noteId: string) {
  return desktopApi().deleteNote(noteId);
}

export function rescanNote(noteId: string): Promise<void> {
  return desktopApi().rescanNote(noteId);
}

export function renameNote(noteId: string, nextTitle: string) {
  return desktopApi().renameNote(noteId, nextTitle);
}

export function togglePinNote(noteId: string, pinned: boolean): Promise<void> {
  return desktopApi().togglePinNote(noteId, pinned);
}

export function moveNote(noteId: string, targetFolderPath: string) {
  return desktopApi().moveNote(noteId, targetFolderPath);
}

export function renameFolder(folderPath: string, nextName: string) {
  return desktopApi().renameFolder(folderPath, nextName);
}

export function moveFolder(folderPath: string, targetParentPath: string) {
  return desktopApi().moveFolder(folderPath, targetParentPath);
}

export function deleteFolder(folderPath: string) {
  return desktopApi().deleteFolder(folderPath);
}

export function updateNotePlainText(noteId: string, plainText: string) {
  return desktopApi().updateNotePlainText(noteId, plainText);
}
