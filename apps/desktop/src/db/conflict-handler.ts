import type { RxConflictHandler } from "rxdb";
import type { NoteDocType } from "./schemas/note.schema";

/**
 * Conflict resolution for notes:
 * - Tombstones win over stale local edits
 * - Local live edits win over delayed live master echoes
 *
 * The backend owns server-arrival ordering. Locally, do not resurrect deleted
 * notes, but keep unsynced live edits from being rolled back by old live echoes.
 */
export const noteConflictHandler: RxConflictHandler<NoteDocType> = {
  isEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  },
  resolve(input, _context) {
    const { newDocumentState, realMasterState } = input;

    if (realMasterState.isDeleted) {
      return Promise.resolve(realMasterState);
    }
    if (newDocumentState.isDeleted) {
      return Promise.resolve(newDocumentState);
    }

    return Promise.resolve(newDocumentState);
  },
};
