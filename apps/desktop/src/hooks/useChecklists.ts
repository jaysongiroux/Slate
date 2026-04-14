import { useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { CHECKLISTS_SETTING_KEY } from "@slate/shared";
import { useSetting } from "./use-settings";
import type { SlateDatabase } from "../db/database";

export interface ChecklistDefinition {
  id: string;
  name: string;
  patterns: string[];
  sortOrder: number;
}

const EMPTY_CHECKLISTS: ChecklistDefinition[] = [];

export function useChecklists(db: SlateDatabase | null) {
  const [checklists, setChecklists] = useSetting<ChecklistDefinition[]>(
    db,
    CHECKLISTS_SETTING_KEY,
    EMPTY_CHECKLISTS,
  );

  const addChecklist = useCallback(
    async (name: string, patterns: string[]) => {
      const newChecklist: ChecklistDefinition = {
        id: uuidv4(),
        name,
        patterns,
        sortOrder: checklists.length,
      };
      await setChecklists([...checklists, newChecklist]);
      return newChecklist;
    },
    [checklists, setChecklists],
  );

  const updateChecklist = useCallback(
    async (id: string, updates: Partial<Pick<ChecklistDefinition, "name" | "patterns">>) => {
      await setChecklists(checklists.map((c) => (c.id === id ? { ...c, ...updates } : c)));
    },
    [checklists, setChecklists],
  );

  const deleteChecklist = useCallback(
    async (id: string) => {
      await setChecklists(checklists.filter((c) => c.id !== id));
    },
    [checklists, setChecklists],
  );

  return { checklists, addChecklist, updateChecklist, deleteChecklist };
}
