import { useCallback, useEffect, useMemo, useRef } from "react";
import { AlertCircle, Cloud, HardDrive, Loader2, LogIn, RefreshCw, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "./components/EmptyState";
import { NovelEditor } from "./components/NovelEditor";
import { ChatSidebar, type ChatSidebarHandle } from "./components/ChatSidebar";
import { CalendarSidebar } from "./components/CalendarSidebar";
import { CalendarView } from "./components/CalendarView";
import { type SidebarMode } from "./components/IconRail";
import { NotesSidebar } from "./components/NotesSidebar";
import { DialogManager } from "./components/DialogManager";
import { useAppStore } from "./stores/app-store";
import { useUiStore } from "./stores/ui-store";
import { useSyncStore } from "./stores/sync-store";
import { useWorkspaceStore } from "./stores/workspace-store";
import { SearchBar } from "./components/SearchBar";
import { Welcome } from "./components/Welcome";
import { DesktopShell } from "./components/desktop-shell/DesktopShell";
import { ScrollArea } from "./components/ui/scroll-area";
import { buildNoteTree } from "./lib/noteTree";
import { cn } from "./lib/utils";
import { mainPanelModeForSidebarMode } from "./lib/app-helpers";
import { useDesktopShellState } from "./hooks/useDesktopShellState";
import { useDatabase } from "./db/DatabaseProvider";
import { useNotes } from "./hooks/use-notes";
import { useFolders } from "./hooks/use-folders";
import { useCalendarState, CREATE_EVENT_DISABLED_REASON } from "./hooks/useCalendarState";
import { useNoteSearch } from "./hooks/useNoteSearch";
import { useAppKeyboardShortcuts } from "./hooks/useAppKeyboardShortcuts";
import { useBackendActions } from "./hooks/useBackendActions";
import { useNoteActions } from "./hooks/useNoteActions";
import {
  addIcsSubscription,
  cancelOidc,
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
  getCalendarStatus,
  importFolder,
  importFiles,
} from "./lib/api";
import { getDatabase } from "./db/database";
import { insertImportedMarkdownNotes } from "./db/import-markdown";

function EditorWithSync({
  noteId,
  onChange,
  onUploadImage,
}: {
  noteId?: string;
  onChange: (markdown: string) => void;
  onUploadImage?: (file: File) => Promise<{ id: string; contentUrl: string }>;
}) {
  const db = useDatabase();

  if (!db) {
    return <div className="min-h-[68vh]" aria-hidden />;
  }

  return <NovelEditor noteId={noteId} onContentChange={onChange} onUploadImage={onUploadImage} />;
}

export function App() {
  const chatSidebarRef = useRef<ChatSidebarHandle | null>(null);

  // Refs to break circular dependency between useNoteActions <-> useBackendActions
  const refreshSnapshotRef = useRef<() => Promise<void>>(async () => {});
  const handleSelectNoteRef = useRef<(noteId: string) => Promise<void>>(async () => {});
  const flushPendingSaveRef = useRef<() => Promise<void>>(async () => {});

  const stableRefreshSnapshot = useCallback(() => refreshSnapshotRef.current(), []);
  const stableHandleSelectNote = useCallback(
    (noteId: string) => handleSelectNoteRef.current(noteId),
    [],
  );
  const stableFlushPendingSave = useCallback(() => flushPendingSaveRef.current(), []);

  // --- RxDB reactive data ---
  const db = useDatabase();
  const rxNotes = useNotes(db);
  const rxFolders = useFolders(db);

  // --- Store selectors (rendering) ---
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const selectedNote = useWorkspaceStore((s) => s.selectedNote);
  const appLoading = useWorkspaceStore((s) => s.appLoading);
  const errorMessage = useWorkspaceStore((s) => s.errorMessage);
  const collapsedPaths = useWorkspaceStore((s) => s.collapsedPaths);
  const togglePath = useWorkspaceStore((s) => s.togglePath);
  const selectedItems = useWorkspaceStore((s) => s.selectedItems);

  const sidebarMode = useAppStore((s) => s.sidebarMode);
  const setSidebarMode = useAppStore((s) => s.setSidebarMode);
  const mainPanelMode = useAppStore((s) => s.mainPanelMode);
  const setMainPanelMode = useAppStore((s) => s.setMainPanelMode);
  const selectedNoteId = useAppStore((s) => s.selectedNoteId);
  const calendarView = useAppStore((s) => s.calendarView);
  const setCalendarView = useAppStore((s) => s.setCalendarView);
  const calendarDate = useAppStore((s) => s.calendarDate);
  const setCalendarDate = useAppStore((s) => s.setCalendarDate);

  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setAddIcsOpen = useUiStore((s) => s.setAddIcsOpen);
  const setCreateEventOpen = useUiStore((s) => s.setCreateEventOpen);
  const setCreateEventSlot = useUiStore((s) => s.setCreateEventSlot);
  const setEditEventOpen = useUiStore((s) => s.setEditEventOpen);
  const setEditingEvent = useUiStore((s) => s.setEditingEvent);

  const saveState = useSyncStore((s) => s.saveState);
  const backendSyncing = useSyncStore((s) => s.backendSyncing);
  const backendEndpoint = useSyncStore((s) => s.backendEndpoint);

  // --- Desktop shell state ---
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarTransitionDisabled,
    isFloatingSidebar,
    desktopShellColumns,
    floatingSidebarWidth,
    mainPanelGridStyle,
    startResize,
    toggleSidebar,
  } = useDesktopShellState();

  // --- Calendar state ---
  const calendar = useCalendarState();

  // --- Note search ---
  const search = useNoteSearch();

  // --- Note actions ---
  const noteActions = useNoteActions({
    notes: rxNotes,
    isFloatingSidebar,
    setSidebarCollapsed,
    setCalendarStatus: calendar.setCalendarStatus,
    setCalendarSidebarRefreshSignal: calendar.setCalendarSidebarRefreshSignal,
  });

  // --- Backend actions ---
  const backendActions = useBackendActions({
    handleSelectNote: stableHandleSelectNote,
    flushPendingSave: stableFlushPendingSave,
    setCalendarVisibilityFiltersState: calendar.setCalendarVisibilityFiltersState,
    setCalendarReminderSettingsState: calendar.setCalendarReminderSettingsState,
    DEFAULT_CALENDAR_REMINDER_SETTINGS: calendar.DEFAULT_CALENDAR_REMINDER_SETTINGS,
  });

  // Wire up the refs now that both hooks are initialized
  refreshSnapshotRef.current = backendActions.refreshSnapshot;
  handleSelectNoteRef.current = noteActions.handleSelectNote;
  flushPendingSaveRef.current = noteActions.flushPendingSave;

  // --- Keyboard shortcuts ---
  const { getShortcut } = useAppKeyboardShortcuts({
    toggleSidebar,
    handleModeChange,
    handleCreateNote: noteActions.handleCreateNote,
    setCreateEventOpen,
    setSearchOpen: useUiStore.getState().setSearchOpen,
    searchInputRef: search.searchInputRef,
  });

  // --- Effects that remain in App.tsx ---

  // Collapse sidebar -> reset chat mode
  useEffect(() => {
    if (!sidebarCollapsed) return;
    const { sidebarMode: mode, setSidebarMode: setMode } = useAppStore.getState();
    if (mode === "chat") {
      setMode(mainPanelMode === "calendar" ? "calendar" : "notes");
    }
  }, [sidebarCollapsed]);

  // --- Derived values ---
  const notes = rxNotes as any[];
  const folders = rxFolders.map((f) => f.path);
  const tree = buildNoteTree(notes, folders);
  const pinnedNotes = notes.filter((n: any) => n.pinned);
  const notesLoading = appLoading;

  const syncStatus = useMemo(() => {
    if (!snapshot.backend.backendReachable) return { icon: WifiOff, label: "Offline" as const };
    if (snapshot.backend.authStatus === "authenticating")
      return {
        icon: Loader2,
        label: "Checking auth" as const,
        iconClassName: "[&_svg]:animate-spin" as const,
      };
    if (snapshot.backend.authStatus !== "authenticated")
      return { icon: LogIn, label: "Sign in required" as const };
    if (saveState === "saving" || backendSyncing)
      return {
        icon: RefreshCw,
        label: "Syncing..." as const,
        iconClassName: "[&_svg]:animate-spin" as const,
      };
    if (saveState === "error")
      return {
        icon: AlertCircle,
        label: "Sync failed" as const,
        iconClassName: "text-red-400" as const,
      };
    if (snapshot.backend.authStatus === "authenticated")
      return { icon: Cloud, label: "Synced to cloud" as const };
    return { icon: HardDrive, label: "Saved locally" as const };
  }, [snapshot.backend.backendReachable, snapshot.backend.authStatus, saveState, backendSyncing]);

  const sidebarToggleLabel = sidebarCollapsed ? "Open left panel" : "Close left panel";
  const topBarShowsNavigation = mainPanelMode !== "calendar";

  function handleModeChange(mode: SidebarMode) {
    setSidebarMode(mode);
    if (mode !== "chat") {
      setMainPanelMode(mainPanelModeForSidebarMode(mode));
    }
    if (sidebarCollapsed && mode === "chat") setSidebarCollapsed(false);
  }

  // --- JSX ---

  const sidebarContent = (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden pl-2 pb-3 pt-3"
      onContextMenu={
        sidebarMode === "notes"
          ? (event) => void noteActions.handleSidebarContextMenu(event)
          : (event) => event.preventDefault()
      }
      style={{ scrollbarWidth: "none" }}
    >
      {sidebarMode === "calendar" ? (
        <CalendarSidebar
          backendReachable={snapshot.backend.backendReachable}
          backendAuthenticated={snapshot.backend.authStatus === "authenticated"}
          selectedCalendarIds={calendar.selectedCalendarIdSet}
          selectedIcsIds={calendar.selectedIcsIdSet}
          refreshSignal={calendar.calendarSidebarRefreshSignal}
          onToggleCalendarVisibility={calendar.handleToggleCalendarVisibility}
          onToggleIcsVisibility={calendar.handleToggleIcsVisibility}
          onStatusChange={calendar.setCalendarStatus}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAddIcs={() => setAddIcsOpen(true)}
          onOpenRenameIcs={noteActions.handleRenameIcs}
        />
      ) : sidebarMode === "chat" ? (
        <ChatSidebar
          ref={chatSidebarRef}
          backendAuthenticated={snapshot.backend.authStatus === "authenticated"}
          notes={notes}
          onBackToNotes={() => {
            const restoreMode = mainPanelMode === "calendar" ? "calendar" : "notes";
            setSidebarMode(restoreMode as SidebarMode);
          }}
          onNoteClick={(docId) => {
            setSidebarMode("notes");
            setMainPanelMode("notes");
            void noteActions.handleSelectNote(docId);
          }}
          onOpenNoteInEditor={(docId) => {
            void noteActions.handleSelectNote(docId);
          }}
        />
      ) : (
        <NotesSidebar
          tree={tree}
          pinnedNotes={pinnedNotes}
          selectedNoteId={selectedNoteId}
          selectedItems={selectedItems}
          collapsedPaths={collapsedPaths}
          onCreateNote={noteActions.handleCreateNote}
          onCreateDailyNote={noteActions.handleCreateDailyNote}
          onCreateFolder={noteActions.handleCreateFolder}
          onCreateTemplate={noteActions.handleCreateTemplate}
          onSelectNote={noteActions.handleSelectNote}
          onDeleteNote={noteActions.handleDeleteNote}
          onRenameNote={noteActions.handleRenameNote}
          onRenameFolder={noteActions.handleRenameFolder}
          onDeleteFolder={noteActions.handleDeleteFolder}
          onMoveNote={noteActions.handleMoveNote}
          onMoveFolder={noteActions.handleMoveFolder}
          onTogglePath={togglePath}
          onTogglePin={noteActions.handleTogglePin}
          onTreeItemClick={noteActions.handleTreeItemClick}
          onBulkDelete={noteActions.handleBulkDelete}
          onClearSelection={() => useWorkspaceStore.getState().setSelectedItems(new Set())}
        />
      )}
    </div>
  );

  const mainContent = (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col",
        isFloatingSidebar && "overflow-hidden",
      )}
    >
      {mainPanelMode === "calendar" ? (
        <CalendarView
          backendAuthenticated={snapshot.backend.authStatus === "authenticated"}
          backendReachable={snapshot.backend.backendReachable}
          selectedCalendarIds={calendar.selectedCalendarIds}
          selectedProviderCalendarIds={calendar.selectedProviderCalendarIds}
          selectedIcsIds={calendar.selectedIcsIds}
          calendarNameBySourceId={calendar.calendarNameBySourceId}
          canCreateEvent={calendar.canCreateEvent}
          createEventDisabledReason={CREATE_EVENT_DISABLED_REASON}
          view={calendarView}
          onViewChange={setCalendarView}
          date={calendarDate}
          onDateChange={setCalendarDate}
          onCreateEvent={(slotInfo) => {
            if (Date.now() - calendar.createEventClosedAt.current < 300) return;
            setCreateEventSlot(slotInfo);
            setCreateEventOpen(true);
          }}
          onDeleteEvent={async (subscriptionId, eventId) => {
            await deleteCalendarEvent({ subscriptionId, eventId });
            toast.success("Event deleted");
          }}
          onEditEvent={(event) => {
            setEditingEvent(event);
            setEditEventOpen(true);
          }}
          refreshSignal={calendar.calendarViewRefreshSignal}
        />
      ) : (
        <>
          <SearchBar
            open={search.searchOpen}
            closing={search.searchClosing}
            query={search.searchQuery}
            index={search.searchIndex}
            count={search.searchCount}
            onQueryChange={search.handleSearchChange}
            onNavigate={search.navigateSearch}
            onClose={search.closeSearch}
            onReplace={search.handleReplace}
            onReplaceAll={search.handleReplaceAll}
            inputRef={search.searchInputRef}
          />
          <ScrollArea className="note-scroll-area min-h-0 h-full flex-1 overflow-hidden">
            {selectedNote ? (
              <div
                className="editor-document h-full min-h-full px-11 pb-10 pt-[18px] max-md:px-6"
                style={{ scrollbarWidth: "none" }}
              >
                <div className="relative">
                  <EditorWithSync
                    noteId={selectedNoteId}
                    onChange={(markdown) => noteActions.updateSelectedNote("markdown", markdown)}
                    onUploadImage={search.handleUploadFile}
                  />
                </div>

                {errorMessage ? (
                  <div className="mt-[18px] rounded-[14px] bg-[rgba(255,146,136,0.12)] px-3.5 py-3 text-[0.9rem] text-danger">
                    {errorMessage}
                  </div>
                ) : null}
              </div>
            ) : notesLoading ? (
              <div className="editor-document min-h-full px-11 pb-10 pt-[18px] max-md:px-6" />
            ) : notes.length === 0 ? (
              <Welcome onCreateNote={() => void noteActions.handleCreateNote()} />
            ) : (
              <EmptyState />
            )}
          </ScrollArea>
        </>
      )}
    </div>
  );

  return (
    <DesktopShell
      mode={sidebarMode}
      desktopShellColumns={desktopShellColumns}
      isFloatingSidebar={isFloatingSidebar}
      sidebarCollapsed={sidebarCollapsed}
      sidebarTransitionDisabled={sidebarTransitionDisabled}
      floatingSidebarWidth={floatingSidebarWidth}
      mainPanelGridStyle={mainPanelGridStyle}
      onDismissFloatingSidebar={() => setSidebarCollapsed(true)}
      onModeChange={handleModeChange}
      onToggleSidebar={toggleSidebar}
      onOpenSettings={() => setSettingsOpen(true)}
      onStartResize={startResize}
      topBarProps={{
        includeNavigation: topBarShowsNavigation,
        sidebarToggleLabel,
        toggleShortcut: getShortcut("toggle-sidebar"),
        onToggleSidebar: toggleSidebar,
        canGoBack: noteActions.canGoBack,
        canGoForward: noteActions.canGoForward,
        onGoBack: noteActions.handleNavBack,
        onGoForward: noteActions.handleNavForward,
        syncStatus,
      }}
      sidebarContent={sidebarContent}
      mainContent={mainContent}
    >
      <DialogManager
        snapshot={snapshot}
        notes={notes}
        folders={folders}
        writableCalendars={calendar.writableCalendars}
        calendarReminderSettings={calendar.calendarReminderSettings}
        calendarReminderSources={calendar.calendarReminderSources}
        onCommandBarSelect={(noteId) => {
          setMainPanelMode("notes");
          setSidebarMode("notes");
          void noteActions.handleSelectNote(noteId);
        }}
        onSettingsOpenChange={(open) => {
          if (open) {
            useSyncStore.getState().setAuthError("");
          }
          setSettingsOpen(open);
        }}
        onBackendEndpointChange={(value) => {
          useSyncStore.getState().setBackendEndpointValue(value);
          useSyncStore.getState().setConnectionStatus("idle");
          useSyncStore.getState().setConnectionError("");
          useSyncStore.getState().setAuthError("");
        }}
        onCalendarReminderSettingsChange={calendar.updateCalendarReminderSettings}
        onTestConnection={backendActions.handleTestConnection}
        onSaveEndpoint={backendActions.handleSaveEndpoint}
        onLogin={backendActions.handleLogin}
        onLoginWithOidc={backendActions.handleOidcLogin}
        onCancelOidc={() => void cancelOidc()}
        onSignOut={backendActions.handleSignOut}
        onFullSync={backendActions.handleFullSync}
        onImportFolder={async () => {
          const result = await importFolder();
          if (result?.notes?.length) {
            const database = await getDatabase();
            await insertImportedMarkdownNotes(database, result.notes);
          }
          if (result && result.imported > 0) {
            await backendActions.refreshSnapshot();
          }
          return result;
        }}
        onImportFiles={async () => {
          const result = await importFiles();
          if (result?.notes?.length) {
            const database = await getDatabase();
            await insertImportedMarkdownNotes(database, result.notes);
          }
          if (result && result.imported > 0) {
            await backendActions.refreshSnapshot();
          }
          return result;
        }}
        onExportNotes={() => {
          useUiStore.getState().setExportNotesOpen(true);
          useUiStore.getState().setSettingsOpen(false);
        }}
        onAddIcsConfirm={async (url, name) => {
          try {
            await addIcsSubscription({ url, name });
            calendar.setCalendarStatus(await getCalendarStatus());
            calendar.setCalendarSidebarRefreshSignal((current) => current + 1);
            toast.success("ICS feed added");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to add ICS feed");
            throw error;
          }
        }}
        onRenameIcsConfirm={noteActions.confirmRenameIcs}
        createEventClosedAtRef={calendar.createEventClosedAt}
        onCreateEventConfirm={async (data) => {
          try {
            await createCalendarEvent(data);
            calendar.setCalendarViewRefreshSignal((n) => n + 1);
            toast.success("Event created");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to create event");
            throw error;
          }
        }}
        onEditEventConfirm={async (data) => {
          try {
            await updateCalendarEvent(data);
            calendar.setCalendarViewRefreshSignal((n) => n + 1);
            toast.success("Event updated");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to update event");
            throw error;
          }
        }}
        onConfirmPendingCreation={noteActions.confirmPendingCreation}
        onConfirmRenameFolder={noteActions.confirmRenameFolder}
        onConfirmRenameNote={noteActions.confirmRenameNote}
        onConfirmDeleteFolder={noteActions.confirmDeleteFolder}
        onConfirmDeleteNote={noteActions.confirmDeleteNote}
        onConfirmBulkDelete={noteActions.confirmBulkDelete}
      />
    </DesktopShell>
  );
}
