import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/app-store";
import { useUiStore } from "../stores/ui-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import { resolveAttachmentUrl, uploadAttachment } from "../lib/api";

export function useNoteSearch() {
  const editorHandleRef = useRef<any>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const selectedNoteId = useAppStore((s) => s.selectedNoteId);
  const searchOpen = useUiStore((s) => s.searchOpen);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const searchClosing = useUiStore((s) => s.searchClosing);
  const setSearchClosing = useUiStore((s) => s.setSearchClosing);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const searchIndex = useUiStore((s) => s.searchIndex);
  const setSearchIndex = useUiStore((s) => s.setSearchIndex);
  const searchCount = useUiStore((s) => s.searchCount);
  const setSearchCount = useUiStore((s) => s.setSearchCount);

  function doSearch(query: string, index: number) {
    const result = editorHandleRef.current?.search(query, index);
    if (result) {
      setSearchIndex(result.index);
      setSearchCount(result.count);
    }
  }

  function closeSearch() {
    setSearchClosing(true);
    doSearch("", 0);
    setTimeout(() => {
      setSearchOpen(false);
      setSearchClosing(false);
      setSearchQuery("");
      setSearchCount(0);
      setSearchIndex(0);
    }, 120);
  }

  function handleSearchChange(query: string) {
    setSearchQuery(query);
    doSearch(query, 0);
  }

  function navigateSearch(direction: 1 | -1) {
    const state = editorHandleRef.current?.getSearchState();
    if (!state) return;
    doSearch(state.query, state.index + direction);
  }

  function handleReplace(replacement: string) {
    const result = editorHandleRef.current?.replace(replacement);
    if (result) {
      setSearchIndex(result.index);
      setSearchCount(result.count);
    }
  }

  function handleReplaceAll(replacement: string) {
    const result = editorHandleRef.current?.replaceAll(replacement);
    if (result) {
      setSearchIndex(result.index);
      setSearchCount(result.count);
    }
  }

  async function handleUploadFile(file: File): Promise<{ id: string; contentUrl: string }> {
    const selectedNote = useWorkspaceStore.getState().selectedNote;
    if (!selectedNote) {
      throw new Error("No note selected");
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await uploadAttachment({
      buffer: arrayBuffer,
      fileName: file.name,
      mimeType: file.type,
      documentId: selectedNote.id,
    });

    const resolved = await resolveAttachmentUrl(result.contentUrl);
    return { id: result.id, contentUrl: resolved };
  }

  // Close search when switching notes
  useEffect(() => {
    if (searchOpen) {
      setSearchOpen(false);
      setSearchClosing(false);
      setSearchQuery("");
      setSearchCount(0);
      setSearchIndex(0);
      editorHandleRef.current?.search("", 0);
    }
  }, [selectedNoteId]);

  return {
    editorHandleRef,
    searchInputRef,
    searchOpen,
    searchClosing,
    searchQuery,
    searchIndex,
    searchCount,
    doSearch,
    closeSearch,
    handleSearchChange,
    navigateSearch,
    handleReplace,
    handleReplaceAll,
    handleUploadFile,
  };
}
