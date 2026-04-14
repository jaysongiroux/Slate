import { useMemo } from "react";
import type { NoteDocType } from "../db/schemas/note.schema";
import type { ChecklistDefinition } from "./useChecklists";

export interface DerivedTaskItem {
  noteId: string;
  notePath: string;
  noteTitle: string;
  text: string;
  checked: boolean;
  taskListIndex: number;
  taskItemIndex: number;
}

function extractTextFromNode(node: any): string {
  if (node.type === "text") return node.text ?? "";
  if (Array.isArray(node.content)) {
    return node.content.map(extractTextFromNode).join("");
  }
  return "";
}

function extractTaskItems(
  note: NoteDocType,
): Omit<DerivedTaskItem, "noteId" | "notePath" | "noteTitle">[] {
  const items: Omit<DerivedTaskItem, "noteId" | "notePath" | "noteTitle">[] = [];
  const content = note.content as { type?: string; content?: any[] };
  if (!content?.content) return items;

  for (let tli = 0; tli < content.content.length; tli++) {
    const block = content.content[tli];
    if (block.type !== "taskList") continue;
    if (!Array.isArray(block.content)) continue;

    for (let tii = 0; tii < block.content.length; tii++) {
      const taskItem = block.content[tii];
      if (taskItem.type !== "taskItem") continue;

      items.push({
        text: extractTextFromNode(taskItem),
        checked: Boolean(taskItem.attrs?.checked),
        taskListIndex: tli,
        taskItemIndex: tii,
      });
    }
  }

  return items;
}

export function useChecklistItems(
  notes: NoteDocType[],
  checklist: ChecklistDefinition | null,
): DerivedTaskItem[] {
  return useMemo(() => {
    if (!checklist || checklist.patterns.length === 0) return [];

    let regexes: RegExp[];
    try {
      regexes = checklist.patterns.map((p) => new RegExp(p));
    } catch {
      return [];
    }

    const matchingNotes = notes.filter(
      (n) => !n.isDeleted && regexes.some((rx) => rx.test(n.path)),
    );

    const allItems: DerivedTaskItem[] = [];
    for (const note of matchingNotes) {
      const extracted = extractTaskItems(note);
      for (const item of extracted) {
        allItems.push({
          ...item,
          noteId: note.id,
          notePath: note.path,
          noteTitle: note.title,
        });
      }
    }

    // Sort: unchecked first, then checked
    allItems.sort((a, b) => {
      if (a.checked !== b.checked) return a.checked ? 1 : -1;
      return 0;
    });

    return allItems;
  }, [notes, checklist]);
}
