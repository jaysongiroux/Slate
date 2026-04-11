import { useState, useEffect, useCallback } from "react";
import type { SlateDatabase } from "../db/database";

export function useSetting<T = unknown>(
  db: SlateDatabase | null,
  key: string,
  defaultValue: T,
): [T, (value: T) => Promise<void>] {
  const [value, setValue] = useState<T>(defaultValue);

  useEffect(() => {
    if (!db) return;

    const sub = db.settings.findOne({ selector: { key } }).$.subscribe((doc) => {
      if (doc) {
        setValue(doc.value as T);
      } else {
        setValue(defaultValue);
      }
    });

    return () => sub.unsubscribe();
  }, [db, key, defaultValue]);

  const updateValue = useCallback(
    async (newValue: T) => {
      if (!db) return;

      await db.settings.upsert({
        id: `setting-${key}`,
        key,
        value: newValue as any,
        updatedAt: new Date().toISOString(),
      });
    },
    [db, key],
  );

  return [value, updateValue];
}

export function useKeyboardShortcuts(db: SlateDatabase | null) {
  return useSetting<Record<string, string>>(db, "keyboardShortcuts", {});
}
