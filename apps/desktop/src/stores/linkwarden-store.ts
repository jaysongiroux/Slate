import { create } from "zustand";

export type LinkwardenView = "dashboard" | "links";

interface LinkwardenState {
  selectedInstanceId: string | null;
  setSelectedInstanceId: (id: string | null) => void;
  view: LinkwardenView;
  setView: (view: LinkwardenView) => void;
  selectedCollectionId: number | null;
  setSelectedCollectionId: (id: number | null) => void;
  selectedTagId: number | null;
  setSelectedTagId: (id: number | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const useLinkwardenStore = create<LinkwardenState>((set) => ({
  selectedInstanceId: null,
  setSelectedInstanceId: (selectedInstanceId) =>
    set({
      selectedInstanceId,
      view: "dashboard",
      selectedCollectionId: null,
      selectedTagId: null,
      searchQuery: "",
    }),
  view: "dashboard",
  setView: (view) => set({ view }),
  selectedCollectionId: null,
  setSelectedCollectionId: (selectedCollectionId) =>
    set({ view: "links", selectedCollectionId, selectedTagId: null, searchQuery: "" }),
  selectedTagId: null,
  setSelectedTagId: (selectedTagId) =>
    set({ view: "links", selectedTagId, selectedCollectionId: null, searchQuery: "" }),
  searchQuery: "",
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
