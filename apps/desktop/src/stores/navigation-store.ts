import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SidebarMode } from "../components/IconRail";

export type NavEntry = { type: "note"; noteId: string } | { type: "mode"; mode: SidebarMode };

const MAX_ENTRIES = 50;

function entriesEqual(a: NavEntry, b: NavEntry): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "note" && b.type === "note") return a.noteId === b.noteId;
  if (a.type === "mode" && b.type === "mode") return a.mode === b.mode;
  return false;
}

type NavigationState = {
  entries: NavEntry[];
  currentIndex: number;
  push: (entry: NavEntry) => void;
  goBack: () => NavEntry | null;
  goForward: () => NavEntry | null;
};

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set, get) => ({
      entries: [],
      currentIndex: -1,

      push: (entry) => {
        const { entries, currentIndex } = get();
        // Skip duplicate consecutive entries
        if (currentIndex >= 0 && entriesEqual(entries[currentIndex], entry)) return;
        // Truncate forward history (browser-style)
        const truncated = entries.slice(0, currentIndex + 1);
        const newEntries = [...truncated, entry];
        // Cap at MAX_ENTRIES, dropping oldest
        if (newEntries.length > MAX_ENTRIES) {
          const overflow = newEntries.length - MAX_ENTRIES;
          set({
            entries: newEntries.slice(overflow),
            currentIndex: newEntries.length - overflow - 1,
          });
        } else {
          set({
            entries: newEntries,
            currentIndex: newEntries.length - 1,
          });
        }
      },

      goBack: () => {
        const { entries, currentIndex } = get();
        if (currentIndex <= 0) return null;
        const newIndex = currentIndex - 1;
        set({ currentIndex: newIndex });
        return entries[newIndex];
      },

      goForward: () => {
        const { entries, currentIndex } = get();
        if (currentIndex >= entries.length - 1) return null;
        const newIndex = currentIndex + 1;
        set({ currentIndex: newIndex });
        return entries[newIndex];
      },
    }),
    {
      name: "slate.navigation",
    },
  ),
);
