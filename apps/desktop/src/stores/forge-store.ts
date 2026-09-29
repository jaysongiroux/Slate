import { create } from "zustand";
import type { ForgeCounts, ForgePrSearchState } from "@slate/shared";

export type ForgeView =
  | "empty"
  | "quick-filter"
  | "saved-search"
  | "repo-prs"
  | "repo-issues"
  | "search-prs";

export type ForgeQuickFilter = "my-prs" | "reviewing" | "notifications" | "assigned-issues";

export type ForgeFilterKind =
  | ForgeQuickFilter
  | "saved-search"
  | "repo-prs"
  | "repo-issues"
  | "search-prs";

export interface ForgeActiveFilter {
  kind: ForgeFilterKind;
  repo?: string;
  savedSearchId?: string;
  query?: string;
  searchState?: ForgePrSearchState;
}

interface ForgeState {
  selectedInstanceId: string | null;
  setSelectedInstanceId: (id: string | null) => void;

  view: ForgeView;
  activeFilter: ForgeActiveFilter | null;
  activeFilterLabel: string | null;
  setActiveFilter: (filter: ForgeActiveFilter, label: string) => void;

  countsByInstance: Record<string, ForgeCounts>;
  setCounts: (instanceId: string, counts: ForgeCounts) => void;

  refreshSignal: number;
  refresh: () => void;

  resetNavigation: () => void;
}

function viewForFilter(kind: ForgeFilterKind): ForgeView {
  if (kind === "repo-prs") return "repo-prs";
  if (kind === "repo-issues") return "repo-issues";
  if (kind === "saved-search") return "saved-search";
  if (kind === "search-prs") return "search-prs";
  return "quick-filter";
}

export const useForgeStore = create<ForgeState>((set) => ({
  selectedInstanceId: null,
  setSelectedInstanceId: (selectedInstanceId) =>
    set({
      selectedInstanceId,
      view: "empty",
      activeFilter: null,
      activeFilterLabel: null,
    }),

  view: "empty",
  activeFilter: null,
  activeFilterLabel: null,
  setActiveFilter: (filter, label) =>
    set({
      activeFilter: filter,
      activeFilterLabel: label,
      view: viewForFilter(filter.kind),
    }),

  countsByInstance: {},
  setCounts: (instanceId, counts) =>
    set((s) => ({ countsByInstance: { ...s.countsByInstance, [instanceId]: counts } })),

  refreshSignal: 0,
  refresh: () => set((s) => ({ refreshSignal: s.refreshSignal + 1 })),

  resetNavigation: () => set({ view: "empty", activeFilter: null, activeFilterLabel: null }),
}));
