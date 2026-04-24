import { create } from "zustand";
import type { DesktopSnapshot, LocalNoteSummary } from "@slate/shared";
import { initialSnapshot } from "../lib/app-helpers";

const COLLAPSED_PATHS_CONFIG_KEY = "collapsedFolderPaths";

function persistCollapsedPaths(paths: Set<string>): void {
  const api = (window as any).slateDesktop;
  if (api?.setConfig) void api.setConfig(COLLAPSED_PATHS_CONFIG_KEY, Array.from(paths));
}

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
  setCollapsedPaths: (v: Set<string>) => void;
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
  setCollapsedPaths: (collapsedPaths) => {
    persistCollapsedPaths(collapsedPaths);
    set({ collapsedPaths });
  },
  togglePath: (path) =>
    set((state) => {
      const next = new Set(state.collapsedPaths);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      persistCollapsedPaths(next);
      return { collapsedPaths: next };
    }),
  selectedItems: new Set<string>(),
  setSelectedItems: (v) =>
    set((state) => ({
      selectedItems: typeof v === "function" ? v(state.selectedItems) : v,
    })),
}));
