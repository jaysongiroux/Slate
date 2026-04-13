import { useEffect, useRef, useState } from "react";
import { type LocalNoteSummary } from "@slate/shared";
import { documentTitleFromMarkdown } from "../lib/document-title-from-markdown";
import { toast } from "sonner";
import { useWorkspaceStore } from "../stores/workspace-store";
import { useAppStore } from "../stores/app-store";
import { useUiStore } from "../stores/ui-store";
import { useSyncStore } from "../stores/sync-store";
import { displayNameFromPath, validatePathSegmentName } from "../lib/note-naming.mjs";
import { basename } from "../lib/noteTree";
import { showContextMenu, updateIcsSubscription, getCalendarStatus } from "../lib/api";
import {
  createDailyNote,
  createFolder,
  createNote,
  createTemplate,
  deleteFolder,
  deleteNote,
  loadNote,
  moveFolder,
  moveNote,
  renameFolder,
  renameNote,
  togglePinNote,
} from "../db/note-operations";
import { getDatabase } from "../db/database";

export function useNoteActions(params: {
  notes: Array<{ id: string; [key: string]: any }>;
  isFloatingSidebar: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  setCalendarStatus: (v: any) => void;
  setCalendarSidebarRefreshSignal: React.Dispatch<React.SetStateAction<number>>;
}) {
  const {
    notes: rxNotes,
    isFloatingSidebar,
    setSidebarCollapsed,
    setCalendarStatus,
    setCalendarSidebarRefreshSignal,
  } = params;

  const loadRequestIdRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedRef = useRef("");
  const selectedNoteRef = useRef<LocalNoteSummary | null>(null);
  const navHistoryRef = useRef<string[]>([]);
  const navIndexRef = useRef(-1);
  const navSkipPushRef = useRef(false);
  const lastClickedItemRef = useRef<{ key: string; parentPath: string } | null>(null);

  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  // Keep ref in sync
  const selectedNote = useWorkspaceStore((s) => s.selectedNote);
  selectedNoteRef.current = selectedNote;

  const selectedNoteId = useAppStore((s) => s.selectedNoteId);

  function updateNavButtons() {
    setCanGoBack(navIndexRef.current > 0);
    setCanGoForward(navIndexRef.current < navHistoryRef.current.length - 1);
  }

  async function handleSelectNote(noteId: string) {
    if (!navSkipPushRef.current) {
      const hist = navHistoryRef.current;
      const idx = navIndexRef.current;
      if (hist[idx] !== noteId) {
        navHistoryRef.current = [...hist.slice(0, idx + 1), noteId];
        navIndexRef.current = navHistoryRef.current.length - 1;
        updateNavButtons();
      }
    }
    navSkipPushRef.current = false;

    await flushPendingSave();
    const requestId = ++loadRequestIdRef.current;
    useAppStore.getState().setSelectedNoteId(noteId);
    useWorkspaceStore.getState().setErrorMessage("");

    // Persist last open note to config
    const api = (window as any).slateDesktop;
    if (api?.setConfig) void api.setConfig("lastOpenNoteId", noteId);

    if (isFloatingSidebar) setSidebarCollapsed(true);

    try {
      const db = await getDatabase();
      const note = await loadNote(db, noteId);
      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      if (!note) {
        useWorkspaceStore.getState().setErrorMessage("Note not found");
        return;
      }

      lastSavedRef.current = JSON.stringify({
        id: note.id,
        title: note.title,
      });
      useWorkspaceStore.getState().setSelectedNote(note as any);
      useSyncStore.getState().setSaveState("saved");
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      useWorkspaceStore
        .getState()
        .setErrorMessage(error instanceof Error ? error.message : "Failed to open note");
    }
  }

  function handleNavBack() {
    if (navIndexRef.current > 0) {
      navIndexRef.current--;
      navSkipPushRef.current = true;
      updateNavButtons();
      void handleSelectNote(navHistoryRef.current[navIndexRef.current]);
    }
  }

  function handleNavForward() {
    if (navIndexRef.current < navHistoryRef.current.length - 1) {
      navIndexRef.current++;
      navSkipPushRef.current = true;
      updateNavButtons();
      void handleSelectNote(navHistoryRef.current[navIndexRef.current]);
    }
  }

  async function persistNote(note: LocalNoteSummary) {
    try {
      lastSavedRef.current = JSON.stringify({ id: note.id, title: note.title });
      // Content saving is handled by the editor's onUpdate -> RxDB save
      // This function just tracks metadata state
      useSyncStore.getState().setSaveState("saved");
    } catch (error) {
      useSyncStore.getState().setSaveState("error");
      useWorkspaceStore
        .getState()
        .setErrorMessage(error instanceof Error ? error.message : "Failed to save note");
    }
  }

  async function flushPendingSave() {
    const current = selectedNoteRef.current;
    if (!current) {
      return;
    }

    const serialized = JSON.stringify({
      id: current.id,
      title: current.title,
    });

    if (serialized === lastSavedRef.current) {
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    await persistNote(current);
  }

  async function reloadSelectedNoteFromDisk(noteId: string) {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const db = await getDatabase();
    const loaded = await loadNote(db, noteId);
    if (selectedNoteRef.current?.id !== noteId || !loaded) {
      return;
    }

    lastSavedRef.current = JSON.stringify({ id: loaded.id, title: loaded.title });
    useWorkspaceStore.getState().setSelectedNote(loaded as any);
    useSyncStore.getState().setSaveState("saved");
  }

  function updateSelectedNote(field: "title" | "markdown", value: string) {
    useWorkspaceStore.getState().setSelectedNote((current) => {
      if (!current) return current;
      if (field === "markdown") {
        return {
          ...current,
          title: documentTitleFromMarkdown(value, { existingTitle: current.title }),
        };
      }
      return { ...current, [field]: value };
    });
  }

  async function handleCreateNote(parentPath?: string) {
    useUiStore.getState().setPendingCreation({ kind: "note", parentPath });
    useUiStore.getState().setPendingCreationValue("Untitled");
  }

  async function confirmPendingCreation() {
    const pendingCreation = useUiStore.getState().pendingCreation;
    const pendingCreationValue = useUiStore.getState().pendingCreationValue;
    if (!pendingCreation) {
      return;
    }

    const name = pendingCreationValue.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }

    try {
      const db = await getDatabase();
      if (pendingCreation.kind === "note") {
        const targetPath =
          typeof pendingCreation.parentPath === "string" ? pendingCreation.parentPath : undefined;
        const note = await createNote(db, targetPath, name);
        await handleSelectNote(note.id);
      } else if (pendingCreation.kind === "template") {
        const parentPath =
          typeof pendingCreation.parentPath === "string" ? pendingCreation.parentPath : undefined;
        const note = await createTemplate(db, name, parentPath);
        await handleSelectNote(note.id);
      } else {
        const targetPath =
          typeof pendingCreation.parentPath === "string" ? pendingCreation.parentPath : undefined;
        const folderPath = await createFolder(db, targetPath, name);
        const { collapsedPaths, togglePath } = useWorkspaceStore.getState();
        if (collapsedPaths.has(folderPath)) {
          togglePath(folderPath);
        }
      }
      useUiStore.getState().setPendingCreation(null);
      useUiStore.getState().setPendingCreationValue("");
    } catch (error) {
      const fallback =
        pendingCreation.kind === "folder"
          ? "Failed to create folder"
          : pendingCreation.kind === "template"
            ? "Failed to create template"
            : "Failed to create note";
      useWorkspaceStore
        .getState()
        .setErrorMessage(error instanceof Error ? error.message : fallback);
    }
  }

  async function handleCreateTemplate(parentPath?: string) {
    useUiStore.getState().setPendingCreation({
      kind: "template",
      ...(parentPath ? { parentPath } : {}),
    });
    useUiStore.getState().setPendingCreationValue("Untitled Template");
  }

  async function handleCreateDailyNote() {
    try {
      const db = await getDatabase();
      const note = await createDailyNote(db);
      await handleSelectNote(note.id);
    } catch (error) {
      useWorkspaceStore
        .getState()
        .setErrorMessage(error instanceof Error ? error.message : "Failed to create daily note");
    }
  }

  async function handleCreateFolder(parentPath?: string) {
    useUiStore.getState().setPendingCreation({ kind: "folder", parentPath });
    useUiStore.getState().setPendingCreationValue("New Folder");
  }

  async function handleMoveNote(noteId: string, targetFolderPath: string) {
    try {
      await flushPendingSave();
      const db = await getDatabase();
      await moveNote(db, noteId, targetFolderPath);
      if (useAppStore.getState().selectedNoteId === noteId) {
        const loaded = await loadNote(db, noteId);
        if (loaded) useWorkspaceStore.getState().setSelectedNote(loaded as any);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to move note");
    }
  }

  async function handleMoveFolder(folderPath: string, targetParentPath: string) {
    try {
      await flushPendingSave();
      const db = await getDatabase();
      await moveFolder(db, folderPath, targetParentPath);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to move folder");
    }
  }

  function deduplicateSelectedItems(items: Set<string>): Set<string> {
    const folderPaths: string[] = [];
    for (const key of items) {
      if (key.startsWith("folder:")) {
        folderPaths.push(key.slice("folder:".length));
      }
    }
    const deduped = new Set<string>();
    for (const key of items) {
      if (key.startsWith("note:")) {
        const noteId = key.slice("note:".length);
        const note = rxNotes.find((n: any) => n.id === noteId);
        if (note) {
          const isChild = folderPaths.some(
            (fp) => note.path.startsWith(fp + "/") || note.path.startsWith(fp + "\\"),
          );
          if (!isChild) deduped.add(key);
        }
      } else if (key.startsWith("folder:")) {
        const fp = key.slice("folder:".length);
        const isChild = folderPaths.some(
          (parentFp) =>
            parentFp !== fp && (fp.startsWith(parentFp + "/") || fp.startsWith(parentFp + "\\")),
        );
        if (!isChild) deduped.add(key);
      }
    }
    return deduped;
  }

  function handleBulkDelete() {
    const selectedItems = useWorkspaceStore.getState().selectedItems;
    if (selectedItems.size < 2) return;
    useUiStore.getState().setDeletingBulk(deduplicateSelectedItems(selectedItems));
  }

  async function confirmBulkDelete() {
    const deletingBulk = useUiStore.getState().deletingBulk;
    if (!deletingBulk) return;
    const items = deletingBulk;
    useUiStore.getState().setDeletingBulk(null);
    useWorkspaceStore.getState().setSelectedItems(new Set());

    try {
      await flushPendingSave();
      const db = await getDatabase();

      const folderPaths: string[] = [];
      const noteIds: string[] = [];
      for (const key of items) {
        if (key.startsWith("folder:")) folderPaths.push(key.slice("folder:".length));
        else if (key.startsWith("note:")) noteIds.push(key.slice("note:".length));
      }

      const currentSelectedNoteId = useAppStore.getState().selectedNoteId;

      for (const fp of folderPaths) {
        await deleteFolder(db, fp);
      }
      for (const id of noteIds) {
        await deleteNote(db, id);
      }

      if (currentSelectedNoteId && noteIds.includes(currentSelectedNoteId)) {
        useAppStore.getState().setSelectedNoteId("");
        useWorkspaceStore.getState().setSelectedNote(null);
      }
    } catch (error) {
      useWorkspaceStore
        .getState()
        .setErrorMessage(error instanceof Error ? error.message : "Failed to delete items");
    }
  }

  function handleTreeItemClick(
    e: React.MouseEvent,
    itemKey: string,
    parentPath: string,
    siblingKeys: string[],
  ) {
    if (e.metaKey || e.ctrlKey) {
      useWorkspaceStore.getState().setSelectedItems((prev) => {
        const next = new Set(prev);
        if (next.has(itemKey)) next.delete(itemKey);
        else next.add(itemKey);
        return next;
      });
      lastClickedItemRef.current = { key: itemKey, parentPath };
      return true;
    }

    if (e.shiftKey && lastClickedItemRef.current) {
      if (lastClickedItemRef.current.parentPath !== parentPath) {
        useWorkspaceStore.getState().setSelectedItems((prev) => {
          const next = new Set(prev);
          if (next.has(itemKey)) next.delete(itemKey);
          else next.add(itemKey);
          return next;
        });
        lastClickedItemRef.current = { key: itemKey, parentPath };
        return true;
      }

      const anchorIdx = siblingKeys.indexOf(lastClickedItemRef.current.key);
      const targetIdx = siblingKeys.indexOf(itemKey);
      if (anchorIdx === -1 || targetIdx === -1) return false;

      const start = Math.min(anchorIdx, targetIdx);
      const end = Math.max(anchorIdx, targetIdx);
      const rangeKeys = siblingKeys.slice(start, end + 1);

      useWorkspaceStore.getState().setSelectedItems((prev) => {
        const next = new Set(prev);
        for (const key of rangeKeys) next.add(key);
        return next;
      });
      return true;
    }

    const selectedItems = useWorkspaceStore.getState().selectedItems;
    if (selectedItems.size > 0) {
      useWorkspaceStore.getState().setSelectedItems(new Set());
    }
    lastClickedItemRef.current = { key: itemKey, parentPath };
    return false;
  }

  async function handleDeleteNote(noteId: string) {
    const note = rxNotes.find((n: any) => n.id === noteId);
    const path = typeof note?.path === "string" ? note.path : "";
    const trimmedTitle = typeof note?.title === "string" ? note.title.trim() : "";
    const displayName = trimmedTitle !== "" ? trimmedTitle : path !== "" ? basename(path) : noteId;
    useUiStore.getState().setDeletingNote({ id: noteId, displayName });
  }

  async function confirmDeleteNote() {
    const deletingNote = useUiStore.getState().deletingNote;
    if (!deletingNote) return;
    const noteId = deletingNote.id;
    useUiStore.getState().setDeletingNote(null);
    try {
      await flushPendingSave();
      const db = await getDatabase();
      await deleteNote(db, noteId);

      const currentSelectedNoteId = useAppStore.getState().selectedNoteId;
      if (currentSelectedNoteId === noteId) {
        useAppStore.getState().setSelectedNoteId("");
        useWorkspaceStore.getState().setSelectedNote(null);
        // RxDB reactive queries will update the note list automatically
      }
    } catch (error) {
      useWorkspaceStore
        .getState()
        .setErrorMessage(error instanceof Error ? error.message : "Failed to delete note");
    }
  }

  async function handleTogglePin(noteId: string, pinned: boolean) {
    const db = await getDatabase();
    await togglePinNote(db, noteId, pinned);
  }

  function handleRenameFolder(folderPath: string, currentName: string) {
    useUiStore.getState().setRenamingFolder({ path: folderPath, name: currentName });
    useUiStore.getState().setRenamingValue(currentName);
  }

  function handleRenameNote(noteId: string, currentPath: string, currentTitle?: string) {
    const trimmed = typeof currentTitle === "string" ? currentTitle.trim() : "";
    const currentName = trimmed !== "" ? trimmed : displayNameFromPath(currentPath);
    useUiStore.getState().setRenamingNote({ id: noteId, title: currentName });
    useUiStore.getState().setRenamingNoteValue(currentName);
  }

  function handleRenameIcs(subscription: { id: string; name: string }) {
    useUiStore.getState().setRenamingIcs(subscription);
    useUiStore.getState().setRenamingIcsValue(subscription.name);
  }

  async function closeRenameFolderDialog() {
    useUiStore.getState().setRenamingFolder(null);
  }

  async function closeRenameNoteDialog() {
    useUiStore.getState().setRenamingNote(null);
    useUiStore.getState().setRenamingNoteValue("");
  }

  async function closeRenameIcsDialog() {
    useUiStore.getState().setRenamingIcs(null);
    useUiStore.getState().setRenamingIcsValue("");
  }

  async function confirmRenameFolder() {
    const renamingFolder = useUiStore.getState().renamingFolder;
    const renamingValue = useUiStore.getState().renamingValue;
    if (!renamingFolder) return;
    const nextName = renamingValue.trim();
    if (!nextName || nextName === renamingFolder.name) {
      useUiStore.getState().setRenamingFolder(null);
      return;
    }

    try {
      await flushPendingSave();
      const db = await getDatabase();
      await renameFolder(db, renamingFolder.path, nextName);
      useUiStore.getState().setRenamingFolder(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename folder");
    }
  }

  async function confirmRenameNote() {
    const renamingNote = useUiStore.getState().renamingNote;
    const renamingNoteValue = useUiStore.getState().renamingNoteValue;
    if (!renamingNote) return;
    if (validatePathSegmentName(renamingNoteValue)) {
      return;
    }
    const nextTitle = renamingNoteValue.trim();
    if (!nextTitle || nextTitle === renamingNote.title) {
      await closeRenameNoteDialog();
      return;
    }

    try {
      await flushPendingSave();
      const db = await getDatabase();
      await renameNote(db, renamingNote.id, nextTitle);
      if (useAppStore.getState().selectedNoteId === renamingNote.id) {
        const loaded = await loadNote(db, renamingNote.id);
        if (loaded) useWorkspaceStore.getState().setSelectedNote(loaded as any);
      }
      await closeRenameNoteDialog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename note");
    }
  }

  async function confirmRenameIcs() {
    const renamingIcs = useUiStore.getState().renamingIcs;
    const renamingIcsValue = useUiStore.getState().renamingIcsValue;
    if (!renamingIcs) return;
    const nextName = renamingIcsValue.trim();
    if (!nextName || nextName === renamingIcs.name) {
      await closeRenameIcsDialog();
      return;
    }

    try {
      await updateIcsSubscription({ id: renamingIcs.id, name: nextName });
      setCalendarStatus(await getCalendarStatus());
      setCalendarSidebarRefreshSignal((current: number) => current + 1);
      toast.success("ICS feed renamed");
      await closeRenameIcsDialog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename ICS feed");
    }
  }

  function handleDeleteFolder(folderPath: string) {
    useUiStore.getState().setDeletingFolder(folderPath);
  }

  async function handleSidebarContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (
      target?.closest(".tree-folder") ||
      target?.closest(".note-row") ||
      target?.closest(".sidebar-heading__button") ||
      target?.closest("button")
    ) {
      return;
    }

    event.preventDefault();
    const selected = await showContextMenu([
      { id: "new-note", label: "New Note" },
      { id: "new-folder", label: "New Folder" },
    ]);

    if (selected === "new-note") {
      void handleCreateNote();
    } else if (selected === "new-folder") {
      void handleCreateFolder();
    }
  }

  async function confirmDeleteFolder() {
    const deletingFolder = useUiStore.getState().deletingFolder;
    if (!deletingFolder) return;
    try {
      await flushPendingSave();
      const db = await getDatabase();
      await deleteFolder(db, deletingFolder);
    } catch (error) {
      useWorkspaceStore
        .getState()
        .setErrorMessage(error instanceof Error ? error.message : "Failed to delete folder");
    }
    useUiStore.getState().setDeletingFolder(null);
  }

  // --- Effects ---

  // Auto-select first note
  useEffect(() => {
    if (selectedNoteId || !rxNotes[0]) {
      return;
    }

    void handleSelectNote(rxNotes[0].id);
  }, [rxNotes, selectedNoteId]);

  // Auto-save timer effect
  useEffect(() => {
    if (!selectedNote) {
      return;
    }

    const serialized = JSON.stringify({
      id: selectedNote.id,
      title: selectedNote.title,
    });

    if (serialized === lastSavedRef.current) {
      useSyncStore.getState().setSaveState("saved");
      return;
    }

    useSyncStore.getState().setSaveState("saving");

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    const noteSnapshot = selectedNote;
    saveTimerRef.current = window.setTimeout(() => {
      void persistNote(noteSnapshot);
    }, 400);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [selectedNote]);

  return {
    canGoBack,
    canGoForward,
    handleSelectNote,
    handleNavBack,
    handleNavForward,
    persistNote,
    flushPendingSave,
    reloadSelectedNoteFromDisk,
    updateSelectedNote,
    handleCreateNote,
    confirmPendingCreation,
    handleCreateTemplate,
    handleCreateDailyNote,
    handleCreateFolder,
    handleMoveNote,
    handleMoveFolder,
    deduplicateSelectedItems,
    handleBulkDelete,
    confirmBulkDelete,
    handleTreeItemClick,
    handleDeleteNote,
    confirmDeleteNote,
    handleTogglePin,
    handleRenameFolder,
    handleRenameNote,
    handleRenameIcs,
    closeRenameFolderDialog,
    closeRenameNoteDialog,
    closeRenameIcsDialog,
    confirmRenameFolder,
    confirmRenameNote,
    confirmRenameIcs,
    handleDeleteFolder,
    handleSidebarContextMenu,
    confirmDeleteFolder,
  };
}
