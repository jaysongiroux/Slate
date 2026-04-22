import { create } from "zustand";
import type { CalendarEvent } from "@slate/shared";

export type PendingCreationKind = "note" | "folder" | "template";

export type PendingCreation = {
  kind: PendingCreationKind;
  parentPath?: string;
};

type UiState = {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  settingsFocus: string | undefined;
  setSettingsFocus: (focus: string | undefined) => void;
  commandBarOpen: boolean;
  setCommandBarOpen: (open: boolean) => void;
  addIcsOpen: boolean;
  setAddIcsOpen: (open: boolean) => void;
  pendingCreation: PendingCreation | null;
  setPendingCreation: (v: PendingCreation | null) => void;
  pendingCreationValue: string;
  setPendingCreationValue: (v: string) => void;
  renamingNote: { id: string; title: string } | null;
  setRenamingNote: (v: { id: string; title: string } | null) => void;
  renamingNoteValue: string;
  setRenamingNoteValue: (v: string) => void;
  renamingFolder: { path: string; name: string } | null;
  setRenamingFolder: (v: { path: string; name: string } | null) => void;
  renamingValue: string;
  setRenamingValue: (v: string) => void;
  deletingFolder: string | null;
  setDeletingFolder: (v: string | null) => void;
  deletingNote: { id: string; displayName: string } | null;
  setDeletingNote: (v: { id: string; displayName: string } | null) => void;
  deletingBulk: Set<string> | null;
  setDeletingBulk: (v: Set<string> | null) => void;
  renamingIcs: { id: string; name: string } | null;
  setRenamingIcs: (v: { id: string; name: string } | null) => void;
  renamingIcsValue: string;
  setRenamingIcsValue: (v: string) => void;
  createEventOpen: boolean;
  setCreateEventOpen: (open: boolean) => void;
  createEventSlot: { start: Date; end: Date; allDay: boolean } | undefined;
  setCreateEventSlot: (v: { start: Date; end: Date; allDay: boolean } | undefined) => void;
  editEventOpen: boolean;
  setEditEventOpen: (open: boolean) => void;
  editingEvent: CalendarEvent | null;
  setEditingEvent: (v: CalendarEvent | null) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  searchClosing: boolean;
  setSearchClosing: (closing: boolean) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchIndex: number;
  setSearchIndex: (i: number) => void;
  searchCount: number;
  setSearchCount: (n: number) => void;
  exportNotesOpen: boolean;
  setExportNotesOpen: (open: boolean) => void;
  addLinkwardenInstanceOpen: boolean;
  setAddLinkwardenInstanceOpen: (open: boolean) => void;
  addLinkwardenLinkOpen: boolean;
  setAddLinkwardenLinkOpen: (open: boolean) => void;
  addHomeAssistantInstanceOpen: boolean;
  setAddHomeAssistantInstanceOpen: (open: boolean) => void;
  addJiraInstanceOpen: boolean;
  setAddJiraInstanceOpen: (open: boolean) => void;
  createJiraIssueOpen: boolean;
  setCreateJiraIssueOpen: (open: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  settingsFocus: undefined,
  setSettingsFocus: (settingsFocus) => set({ settingsFocus }),
  commandBarOpen: false,
  setCommandBarOpen: (commandBarOpen) => set({ commandBarOpen }),
  addIcsOpen: false,
  setAddIcsOpen: (addIcsOpen) => set({ addIcsOpen }),
  pendingCreation: null,
  setPendingCreation: (pendingCreation) => set({ pendingCreation }),
  pendingCreationValue: "",
  setPendingCreationValue: (pendingCreationValue) => set({ pendingCreationValue }),
  renamingNote: null,
  setRenamingNote: (renamingNote) => set({ renamingNote }),
  renamingNoteValue: "",
  setRenamingNoteValue: (renamingNoteValue) => set({ renamingNoteValue }),
  renamingFolder: null,
  setRenamingFolder: (renamingFolder) => set({ renamingFolder }),
  renamingValue: "",
  setRenamingValue: (renamingValue) => set({ renamingValue }),
  deletingFolder: null,
  setDeletingFolder: (deletingFolder) => set({ deletingFolder }),
  deletingNote: null,
  setDeletingNote: (deletingNote) => set({ deletingNote }),
  deletingBulk: null,
  setDeletingBulk: (deletingBulk) => set({ deletingBulk }),
  renamingIcs: null,
  setRenamingIcs: (renamingIcs) => set({ renamingIcs }),
  renamingIcsValue: "",
  setRenamingIcsValue: (renamingIcsValue) => set({ renamingIcsValue }),
  createEventOpen: false,
  setCreateEventOpen: (createEventOpen) => set({ createEventOpen }),
  createEventSlot: undefined,
  setCreateEventSlot: (createEventSlot) => set({ createEventSlot }),
  editEventOpen: false,
  setEditEventOpen: (editEventOpen) => set({ editEventOpen }),
  editingEvent: null,
  setEditingEvent: (editingEvent) => set({ editingEvent }),
  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  searchClosing: false,
  setSearchClosing: (searchClosing) => set({ searchClosing }),
  searchQuery: "",
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  searchIndex: 0,
  setSearchIndex: (searchIndex) => set({ searchIndex }),
  searchCount: 0,
  setSearchCount: (searchCount) => set({ searchCount }),
  exportNotesOpen: false,
  setExportNotesOpen: (exportNotesOpen) => set({ exportNotesOpen }),
  addLinkwardenInstanceOpen: false,
  setAddLinkwardenInstanceOpen: (addLinkwardenInstanceOpen) => set({ addLinkwardenInstanceOpen }),
  addLinkwardenLinkOpen: false,
  setAddLinkwardenLinkOpen: (addLinkwardenLinkOpen) => set({ addLinkwardenLinkOpen }),
  addHomeAssistantInstanceOpen: false,
  setAddHomeAssistantInstanceOpen: (addHomeAssistantInstanceOpen) =>
    set({ addHomeAssistantInstanceOpen }),
  addJiraInstanceOpen: false,
  setAddJiraInstanceOpen: (addJiraInstanceOpen) => set({ addJiraInstanceOpen }),
  createJiraIssueOpen: false,
  setCreateJiraIssueOpen: (createJiraIssueOpen) => set({ createJiraIssueOpen }),
}));
