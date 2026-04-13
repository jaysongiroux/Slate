import { create } from "zustand";
import type { DesktopSnapshot, LocalNoteSummary } from "@slate/shared";
import { initialSnapshot } from "../lib/app-helpers";

type WorkspaceState = {
  snapshot: DesktopSnapshot;
  setSnapshot: (s: DesktopSnapshot | ((prev: DesktopSnapshot) => DesktopSnapshot)) => void;
  selectedNote: LocalNoteSummary | null;
  setSelectedNote: (
    n: LocalNoteSummary | null | ((prev: LocalNoteSummary | null) => LocalNoteSummary | null),
  ) => void;
  appLoading: boolean;
  setAppLoading: (v: boolean) => void;
  errorMessage: string;
  setErrorMessage: (v: string) => void;
  collapsedPaths: Set<string>;
  togglePath: (path: string) => void;
  selectedItems: Set<string>;
  setSelectedItems: (v: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  snapshot: initialSnapshot(),
  setSnapshot: (s) =>
    set((state) => ({
      snapshot: typeof s === "function" ? s(state.snapshot) : s,
    })),
  selectedNote: null,
  setSelectedNote: (n) =>
    set((state) => ({
      selectedNote: typeof n === "function" ? n(state.selectedNote) : n,
    })),
  appLoading: true,
  setAppLoading: (appLoading) => set({ appLoading }),
  errorMessage: "",
  setErrorMessage: (errorMessage) => set({ errorMessage }),
  collapsedPaths: new Set<string>(),
  togglePath: (path) =>
    set((state) => {
      const next = new Set(state.collapsedPaths);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return { collapsedPaths: next };
    }),
  selectedItems: new Set<string>(),
  setSelectedItems: (v) =>
    set((state) => ({
      selectedItems: typeof v === "function" ? v(state.selectedItems) : v,
    })),
}));
