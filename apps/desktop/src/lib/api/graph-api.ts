import { desktopApi, type NoteGraphPayload } from "./ipc-core";

export type { NoteGraphPayload };

export function getNoteGraph() {
  return desktopApi().getNoteGraph();
}

export function deleteNoteGraphEdges() {
  return desktopApi().deleteNoteGraphEdges();
}

export function enqueueNoteGraphRebuild() {
  return desktopApi().enqueueNoteGraphRebuild();
}
