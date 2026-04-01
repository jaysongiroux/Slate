import { useCallback, useEffect, useState } from "react";
import { getKeyboardShortcuts, setKeyboardShortcut as apiSetShortcut } from "./api";

const DEFAULT_SHORTCUTS: Record<string, string> = {
  "command-bar": "mod+p",
  "find-in-note": "mod+f",
  // Also creates an event when the calendar view is active.
  "new-note": "mod+n",
  "toggle-sidebar": "mod+b",
};

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const needsMod = parts.includes("mod");
  const needsShift = parts.includes("shift");
  const needsAlt = parts.includes("alt");

  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const modPressed = isMac ? event.metaKey : event.ctrlKey;

  if (needsMod && !modPressed) return false;
  if (!needsMod && modPressed) return false;
  if (needsShift !== event.shiftKey) return false;
  if (needsAlt !== event.altKey) return false;

  return event.key.toLowerCase() === key;
}

export function useKeyboardShortcuts() {
  const [shortcuts, setShortcuts] = useState<Record<string, string>>(DEFAULT_SHORTCUTS);

  useEffect(() => {
    let cancelled = false;
    getKeyboardShortcuts().then((overrides) => {
      if (cancelled) return;
      const merged = { ...DEFAULT_SHORTCUTS };
      for (const { action, shortcut } of overrides) {
        merged[action] = shortcut;
      }
      setShortcuts(merged);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const getShortcut = useCallback(
    (action: string): string => {
      return shortcuts[action] ?? "";
    },
    [shortcuts],
  );

  const setShortcut = useCallback((action: string, shortcut: string) => {
    setShortcuts((prev) => ({ ...prev, [action]: shortcut }));
    void apiSetShortcut(action, shortcut);
  }, []);

  return { shortcuts, getShortcut, setShortcut };
}
