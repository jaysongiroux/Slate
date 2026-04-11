import type { RxConflictHandler } from "rxdb";
import type { NoteDocType } from "./schemas/note.schema";

/**
 * Conflict resolution for notes:
 * - Latest updatedAt wins
 * - Edits always win over deletes (a deleted note that was edited reappears)
 */
export const noteConflictHandler: RxConflictHandler<NoteDocType> = {
  isEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  },
  resolve(input, _context) {
    const { newDocumentState, realMasterState } = input;

    // Edit wins over delete
    if (realMasterState.isDeleted && !newDocumentState.isDeleted) {
      return Promise.resolve(newDocumentState);
    }
    if (!realMasterState.isDeleted && newDocumentState.isDeleted) {
      return Promise.resolve(realMasterState);
    }

    // Latest updatedAt wins
    const masterTime = new Date(realMasterState.updatedAt).getTime();
    const localTime = new Date(newDocumentState.updatedAt).getTime();

    return Promise.resolve(localTime >= masterTime ? newDocumentState : realMasterState);
  },
};
