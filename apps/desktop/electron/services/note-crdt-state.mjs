export async function ensureNoteCrdtState({ noteId, workspaceService, ydocManager }) {
  if (!noteId) {
    return null;
  }

  if (!ydocManager.hasCrdtState(noteId)) {
    const note = await workspaceService.loadNote(noteId);
    await ydocManager.bootstrapFromMarkdown(noteId, note.markdown ?? "");
  }

  return ydocManager.getFullState(noteId);
}
