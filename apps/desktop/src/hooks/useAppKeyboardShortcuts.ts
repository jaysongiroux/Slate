import { useEffect } from "react";
import type { SidebarMode } from "../components/IconRail";
import { useAppStore } from "../stores/app-store";
import { useUiStore } from "../stores/ui-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import { useKeyboardShortcuts, matchesShortcut } from "../lib/shortcuts";

export function useAppKeyboardShortcuts(params: {
  toggleSidebar: () => void;
  handleModeChange: (mode: SidebarMode) => void;
  handleCreateNote: (parentPath?: string) => void;
  setCreateEventOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const {
    toggleSidebar,
    handleModeChange,
    handleCreateNote,
    setCreateEventOpen,
    setSearchOpen,
    searchInputRef,
  } = params;

  const { getShortcut } = useKeyboardShortcuts();
  const selectedNote = useWorkspaceStore((s) => s.selectedNote);
  const mainPanelMode = useAppStore((s) => s.mainPanelMode);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const toggleSidebarShortcut = getShortcut("toggle-sidebar");
      const cmdBarShortcut = getShortcut("command-bar");
      const findShortcut = getShortcut("find-in-note");

      if (toggleSidebarShortcut && matchesShortcut(e, toggleSidebarShortcut)) {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      if (cmdBarShortcut && matchesShortcut(e, cmdBarShortcut)) {
        e.preventDefault();
        const open = useUiStore.getState().commandBarOpen;
        useUiStore.getState().setCommandBarOpen(!open);
        return;
      }

      const exportNotesShortcut = getShortcut("export-notes");
      if (exportNotesShortcut && matchesShortcut(e, exportNotesShortcut)) {
        e.preventDefault();
        useUiStore.getState().setExportNotesOpen(true);
        return;
      }

      if (findShortcut && matchesShortcut(e, findShortcut) && selectedNote) {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }

      const newNoteShortcut = getShortcut("new-note");
      if (newNoteShortcut && matchesShortcut(e, newNoteShortcut)) {
        e.preventDefault();
        if (mainPanelMode === "calendar") {
          setCreateEventOpen(true);
        } else {
          void handleCreateNote();
        }
        return;
      }

      const tabNotesShortcut = getShortcut("tab-notes");
      if (tabNotesShortcut && matchesShortcut(e, tabNotesShortcut)) {
        e.preventDefault();
        handleModeChange("notes");
        return;
      }

      const tabCalendarShortcut = getShortcut("tab-calendar");
      if (tabCalendarShortcut && matchesShortcut(e, tabCalendarShortcut)) {
        e.preventDefault();
        handleModeChange("calendar");
        return;
      }

      const tabChatShortcut = getShortcut("tab-chat");
      if (tabChatShortcut && matchesShortcut(e, tabChatShortcut)) {
        e.preventDefault();
        handleModeChange("chat");
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNote, getShortcut, mainPanelMode]);

  return { getShortcut };
}
