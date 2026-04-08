import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  deriveDocumentTitle,
  type CalendarInfo,
  type DesktopSnapshot,
  type LocalNoteSummary,
} from "@slate/shared";
import {
  AlertCircle,
  CalendarPlus,
  Cloud,
  FilePlus2,
  FileStack,
  FolderPlus,
  HardDrive,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { DeleteFolderDialog } from "./components/DeleteFolderDialog";
import { DeleteNoteDialog } from "./components/DeleteNoteDialog";
import { EmptyState } from "./components/EmptyState";
import { NovelEditor } from "./components/NovelEditor";
import { TreeBranch, PinnedSection, TreeSidebarDndHoverLock } from "./components/NoteTree";
import { RenameFolderDialog } from "./components/RenameFolderDialog";
import { RenameIcsDialog } from "./components/RenameIcsDialog";
import { ChatSidebar, type ChatSidebarHandle } from "./components/ChatSidebar";
import { CalendarSidebar } from "./components/CalendarSidebar";
import { CalendarView, type CalendarViewType } from "./components/CalendarView";
import { CreateEventDialog } from "./components/CreateEventDialog";
import { EditEventDialog } from "./components/EditEventDialog";
import { type SidebarMode } from "./components/IconRail";
import { AddIcsDialog } from "./components/AddIcsDialog";
import { CommandBar } from "./components/CommandBar";
import { SearchBar } from "./components/SearchBar";
import { SettingsDialog, type ConnectionStatus } from "./components/SettingsDialog";
import { Welcome } from "./components/Welcome";
import { DesktopShell } from "./components/desktop-shell/DesktopShell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import { ScrollArea } from "./components/ui/scroll-area";
import { buildNoteTree } from "./lib/noteTree";
import { displayNameFromPath, validatePathSegmentName } from "./lib/note-naming.mjs";
import { cn } from "./lib/utils";
import { listenForSyncStatus } from "./lib/backend-sync.mjs";
import { parseDndActiveKind, parseDndDropTargetId } from "./lib/noteTreeDnd";
import { useKeyboardShortcuts, matchesShortcut } from "./lib/shortcuts";
import { useDesktopShellState } from "./hooks/useDesktopShellState";
import { SyncProvider, useSyncContext } from "./lib/sync-provider";
import {
  addIcsSubscription,
  cancelOidc,
  checkBackendConnection,
  createCalendarEvent,
  createDailyNote,
  createFolder,
  createNote,
  deleteCalendarEvent,
  updateCalendarEvent,
  deleteFolder,
  deleteNote,
  togglePinNote,
  updateNotePlainText,
  importFolder,
  getCalendarStatus,
  getCalendarReminderSettings,
  getCalendarVisibilityFilters,
  getLastOpenNoteId,
  getLastSidebarMode,
  getSnapshot,
  loginWithOidc,
  loginWithPassword,
  loadNote,
  moveNote,
  moveFolder,
  refreshBackendStatus,
  renameNote,
  renameFolder,
  resolveAttachmentUrl,
  saveNote,
  setBackendEndpoint,
  setCalendarReminderSettings,
  setCalendarVisibilityFilters,
  getLastCalendarView,
  setLastCalendarView,
  getLastCalendarDate,
  setLastCalendarDate,
  setLastOpenNoteId,
  setLastSidebarMode,
  showContextMenu,
  signOutBackend,
  updateIcsSubscription,
  createTemplate,
  uploadAttachment,
  type CalendarReminderSettings,
  type CalendarStatusResponse,
  type CalendarVisibilityFilters,
} from "./lib/api";

const BACKEND_STATUS_POLL_MS = 15000;
const CREATE_EVENT_DISABLED_REASON = "Enable or connect a writable calendar to create events.";
const DEFAULT_CALENDAR_REMINDER_SETTINGS: CalendarReminderSettings = {
  enabled: false,
  minutesBeforeStart: 10,
  playSound: true,
  enabledCalendarIds: null,
};

type CreateEntityKind = "note" | "folder" | "template";

type PendingCreation = {
  kind: CreateEntityKind;
  parentPath?: string;
};

function isSidebarMode(value: unknown): value is SidebarMode {
  return value === "notes" || value === "chat" || value === "calendar";
}

function mainPanelModeForSidebarMode(mode: SidebarMode): "notes" | "calendar" {
  return mode === "calendar" ? "calendar" : "notes";
}

function arraysEqual(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function filtersEqual(a: CalendarVisibilityFilters | null, b: CalendarVisibilityFilters | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    arraysEqual(a.selectedCalendarIds, b.selectedCalendarIds) &&
    arraysEqual(a.selectedIcsIds, b.selectedIcsIds) &&
    arraysEqual(a.knownCalendarIds ?? [], b.knownCalendarIds ?? []) &&
    arraysEqual(a.knownIcsIds ?? [], b.knownIcsIds ?? [])
  );
}

function reconcileCalendarVisibilityFilters(
  status: CalendarStatusResponse,
  persisted: CalendarVisibilityFilters | null,
): CalendarVisibilityFilters {
  const availableCalendarIds = status.connections.flatMap((connection) =>
    connection.calendars
      .filter((calendar) => calendar.enabled)
      .map((calendar) => calendar.subscriptionId),
  );
  const availableIcsIds = status.icsSubscriptions
    .filter((subscription) => subscription.enabled)
    .map((subscription) => subscription.id);

  const previousKnownCalendarIds = new Set(persisted?.knownCalendarIds ?? []);
  const previousKnownIcsIds = new Set(persisted?.knownIcsIds ?? []);
  const selectedCalendarIds = new Set(persisted?.selectedCalendarIds ?? availableCalendarIds);
  const selectedIcsIds = new Set(persisted?.selectedIcsIds ?? availableIcsIds);

  const reconciledCalendarIds = availableCalendarIds.filter(
    (id) => selectedCalendarIds.has(id) || !previousKnownCalendarIds.has(id),
  );
  const reconciledIcsIds = availableIcsIds.filter(
    (id) => selectedIcsIds.has(id) || !previousKnownIcsIds.has(id),
  );

  return {
    selectedCalendarIds: reconciledCalendarIds,
    selectedIcsIds: reconciledIcsIds,
    knownCalendarIds: availableCalendarIds,
    knownIcsIds: availableIcsIds,
  };
}

function stableBackendFingerprint(b: DesktopSnapshot["backend"]): string {
  return JSON.stringify({
    endpoint: b.endpoint,
    clientId: b.clientId,
    backendReachable: b.backendReachable,
    authStatus: b.authStatus,
    authProviders: b.authProviders,
    authenticatedUserId: b.authenticatedUserId,
    authenticatedEmail: b.authenticatedEmail,
    authenticatedDisplayName: b.authenticatedDisplayName,
    authenticatedIsAdmin: b.authenticatedIsAdmin,
    tokenExpiresAtUnix: b.tokenExpiresAtUnix,
  });
}

function initialSnapshot(): DesktopSnapshot {
  return {
    backend: {
      endpoint: "localhost:4000",
      clientId: "loading",
      backendReachable: false,
      authStatus: "signed_out",
      authProviders: [],
    },
    notes: [],
    folders: [],
  };
}

function EditorWithSync({
  onChange,
  onUploadImage,
}: {
  onChange: (markdown: string) => void;
  onUploadImage?: (file: File) => Promise<{ id: string; contentUrl: string }>;
}) {
  const { isReady } = useSyncContext();

  if (!isReady) {
    return <div className="min-h-[68vh]" aria-hidden />;
  }

  return <NovelEditor onContentChange={onChange} onUploadImage={onUploadImage} />;
}

type SaveState = "idle" | "saving" | "saved" | "error";
export function App() {
  const [snapshot, setSnapshot] = useState<DesktopSnapshot>(initialSnapshot);
  const [appLoading, setAppLoading] = useState(true);
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [selectedNote, setSelectedNote] = useState<LocalNoteSummary | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [backendSyncing, setBackendSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingCreation, setPendingCreation] = useState<PendingCreation | null>(null);
  const [pendingCreationValue, setPendingCreationValue] = useState("");
  const [renamingNote, setRenamingNote] = useState<{ id: string; title: string } | null>(null);
  const [renamingNoteValue, setRenamingNoteValue] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<{ path: string; name: string } | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);
  const [deletingNote, setDeletingNote] = useState<{ id: string; path: string } | null>(null);
  const [backendEndpoint, setBackendEndpointValue] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [connectionError, setConnectionError] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("notes");
  const [mainPanelMode, setMainPanelMode] = useState<"notes" | "calendar">("notes");
  const [calendarView, setCalendarView] = useState<CalendarViewType>("month");
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [addIcsOpen, setAddIcsOpen] = useState(false);
  const [renamingIcs, setRenamingIcs] = useState<{ id: string; name: string } | null>(null);
  const [renamingIcsValue, setRenamingIcsValue] = useState("");
  const [calendarSidebarRefreshSignal, setCalendarSidebarRefreshSignal] = useState(0);
  const [calendarViewRefreshSignal, setCalendarViewRefreshSignal] = useState(0);
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [createEventSlot, setCreateEventSlot] = useState<
    { start: Date; end: Date; allDay: boolean } | undefined
  >();
  const createEventClosedAt = useRef(0);
  const [editEventOpen, setEditEventOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<import("@slate/shared").CalendarEvent | null>(
    null,
  );
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatusResponse | null>(null);
  const [calendarVisibilityFilters, setCalendarVisibilityFiltersState] =
    useState<CalendarVisibilityFilters | null>(null);
  const [calendarReminderSettings, setCalendarReminderSettingsState] =
    useState<CalendarReminderSettings>(DEFAULT_CALENDAR_REMINDER_SETTINGS);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchClosing, setSearchClosing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchCount, setSearchCount] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // TODO: Search/replace will need TipTap editor ref — deferring to follow-up
  const editorHandleRef = useRef<any>(null);
  const chatSidebarRef = useRef<ChatSidebarHandle | null>(null);
  const lastPolledBackendFingerprintRef = useRef<string | null>(null);

  const loadRequestIdRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedRef = useRef("");
  const selectedNoteRef = useRef<LocalNoteSummary | null>(null);
  const navHistoryRef = useRef<string[]>([]);
  const navIndexRef = useRef(-1);
  const navSkipPushRef = useRef(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  selectedNoteRef.current = selectedNote;

  const { getShortcut } = useKeyboardShortcuts();
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

  const treeDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function handleTreeDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const targetParent = parseDndDropTargetId(String(over.id));
    if (targetParent === null) return;
    const parsed = parseDndActiveKind(String(active.id));
    if (!parsed) return;
    if (parsed.kind === "note") {
      void handleMoveNote(parsed.noteId, targetParent);
      return;
    }
    const fp = parsed.path.replace(/\\/g, "/");
    const t = targetParent.replace(/\\/g, "/");
    if (t === fp || t.startsWith(`${fp}/`)) return;
    void handleMoveFolder(parsed.path, targetParent);
  }

  useEffect(() => {
    void initializeApp();
  }, []);

  useEffect(() => {
    return listenForSyncStatus(window, (status: string) => {
      setBackendSyncing(status === "syncing");
    });
  }, []);

  useEffect(() => {
    const api = (window as any).slateDesktop;
    if (!api?.onWorkspaceChanged) return;

    api.onWorkspaceChanged((diskRelPaths: string[]) => {
      const paths = Array.isArray(diskRelPaths) ? diskRelPaths : [];
      const current = selectedNoteRef.current;
      void (async () => {
        if (current && paths.length > 0) {
          const norm = (p: string) => p.replace(/\\/g, "/");
          const openPath = norm(current.path);
          const touchedOpenNote = paths.some((p) => norm(p) === openPath);
          if (touchedOpenNote) {
            try {
              await reloadSelectedNoteFromDisk(current.id);
              toast("This note changed on disk and was reloaded.");
            } catch {
              // refreshSnapshot below will reconcile selection if the note disappeared
            }
          }
        }
        await refreshSnapshot();
      })();
    });

    return () => api.offWorkspaceChanged?.();
  }, []);

  useEffect(() => {
    if (!settingsOpen) {
      setBackendEndpointValue(snapshot.backend.endpoint);
    }
  }, [snapshot.backend.endpoint, settingsOpen]);

  useEffect(() => {
    if (selectedNoteId || !snapshot.notes[0]) {
      return;
    }

    void handleSelectNote(snapshot.notes[0].id);
  }, [snapshot.notes, selectedNoteId]);

  useEffect(() => {
    if (!selectedNote) {
      return;
    }

    const serialized = JSON.stringify({
      id: selectedNote.id,
      title: selectedNote.title,
    });

    if (serialized === lastSavedRef.current) {
      setSaveState("saved");
      return;
    }

    setSaveState("saving");

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

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void updateBackendStatus();
    }, BACKEND_STATUS_POLL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (appLoading) return;
    void setLastSidebarMode(sidebarMode);
  }, [appLoading, sidebarMode]);

  useEffect(() => {
    if (sidebarCollapsed && sidebarMode === "chat") {
      setSidebarMode(mainPanelMode === "calendar" ? "calendar" : "notes");
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (appLoading) return;
    void setLastCalendarView(calendarView);
  }, [appLoading, calendarView]);

  useEffect(() => {
    if (appLoading) return;
    void setLastCalendarDate(calendarDate.toISOString());
  }, [appLoading, calendarDate]);

  async function initializeApp() {
    try {
      const [
        nextSnapshot,
        lastNoteId,
        lastSidebarMode,
        savedCalendarVisibilityFilters,
        savedCalendarReminderSettings,
        savedCalendarView,
        savedCalendarDate,
      ] = await Promise.all([
        getSnapshot(),
        getLastOpenNoteId(),
        getLastSidebarMode(),
        getCalendarVisibilityFilters(),
        getCalendarReminderSettings(),
        getLastCalendarView(),
        getLastCalendarDate(),
      ]);
      setSnapshot(nextSnapshot);
      setCalendarVisibilityFiltersState(savedCalendarVisibilityFilters);
      setCalendarReminderSettingsState(
        savedCalendarReminderSettings ?? DEFAULT_CALENDAR_REMINDER_SETTINGS,
      );
      if (savedCalendarView) setCalendarView(savedCalendarView as CalendarViewType);
      if (savedCalendarDate) setCalendarDate(new Date(savedCalendarDate));
      lastPolledBackendFingerprintRef.current = stableBackendFingerprint(nextSnapshot.backend);
      if (!settingsOpen) {
        setBackendEndpointValue(nextSnapshot.backend.endpoint);
      }

      const restoredSidebarMode = isSidebarMode(lastSidebarMode) ? lastSidebarMode : "notes";
      setSidebarMode(restoredSidebarMode);
      setMainPanelMode(mainPanelModeForSidebarMode(restoredSidebarMode));

      const targetId =
        lastNoteId && nextSnapshot.notes.some((n) => n.id === lastNoteId)
          ? lastNoteId
          : nextSnapshot.notes[0]?.id;
      if (targetId) {
        await handleSelectNote(targetId);
      }

      await updateBackendStatus();
    } finally {
      setAppLoading(false);
    }
  }

  function updateCalendarReminderSettings(
    update:
      | CalendarReminderSettings
      | ((current: CalendarReminderSettings) => CalendarReminderSettings),
  ) {
    setCalendarReminderSettingsState((current) => {
      const next = typeof update === "function" ? update(current) : update;
      void setCalendarReminderSettings(next);
      return next;
    });
  }

  function applyBackendConfig(nextBackend: DesktopSnapshot["backend"]) {
    setSnapshot((current) => ({
      ...current,
      backend: {
        ...current.backend,
        ...nextBackend,
      },
    }));
  }

  async function refreshSnapshot() {
    try {
      const nextSnapshot = await getSnapshot();
      setSnapshot(nextSnapshot);
      lastPolledBackendFingerprintRef.current = stableBackendFingerprint(nextSnapshot.backend);
      if (!settingsOpen) {
        setBackendEndpointValue(nextSnapshot.backend.endpoint);
      }

      if (selectedNoteId && !nextSnapshot.notes.some((note) => note.id === selectedNoteId)) {
        setSelectedNoteId("");
        setSelectedNote(null);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load workspace");
    }
  }

  async function reloadSelectedNoteFromDisk(noteId: string) {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const loaded = await loadNote(noteId);
    if (selectedNoteRef.current?.id !== noteId) {
      return;
    }

    lastSavedRef.current = JSON.stringify({ id: loaded.id, title: loaded.title });
    setSelectedNote(loaded);
    setSaveState("saved");
  }

  async function updateBackendStatus() {
    try {
      const backend = await refreshBackendStatus();
      const fp = stableBackendFingerprint(backend);
      if (fp === lastPolledBackendFingerprintRef.current) {
        return;
      }
      lastPolledBackendFingerprintRef.current = fp;
      applyBackendConfig(backend);
      await refreshSnapshot();
    } catch {
      // Keep the last known snapshot if a background status poll fails unexpectedly.
    }
  }

  async function handleTestConnection() {
    const endpoint = backendEndpoint.trim();
    if (!endpoint) return;
    setConnectionStatus("testing");
    setConnectionError("");
    try {
      const reachable = await checkBackendConnection(endpoint);
      setConnectionStatus(reachable ? "success" : "error");
      setConnectionError(reachable ? "" : "Health check failed at /api/health.");
    } catch (error) {
      setConnectionStatus("error");
      setConnectionError(error instanceof Error ? error.message : "Connection failed");
    }
  }

  async function handleSaveEndpoint() {
    const endpoint = backendEndpoint.trim();
    if (!endpoint) return;

    setConnectionStatus("testing");
    setConnectionError("");

    try {
      const savedBackend = await setBackendEndpoint(endpoint);
      applyBackendConfig(savedBackend);
      setBackendEndpointValue(savedBackend.endpoint);

      const refreshedBackend = await refreshBackendStatus();
      applyBackendConfig(refreshedBackend);
      await refreshSnapshot();
      setConnectionStatus(refreshedBackend.backendReachable ? "success" : "error");
      setConnectionError(
        refreshedBackend.backendReachable ? "" : "Saved, but the backend is offline.",
      );
      setAuthPassword("");
      setAuthError("");
    } catch (error) {
      setConnectionStatus("error");
      setConnectionError(error instanceof Error ? error.message : "Failed to save endpoint");
      setErrorMessage(error instanceof Error ? error.message : "Failed to save endpoint");
    }
  }

  async function handleLogin() {
    if (!authEmail.trim() || !authPassword) {
      return;
    }

    setAuthSubmitting(true);
    setAuthError("");

    try {
      const backend = await loginWithPassword({
        email: authEmail.trim(),
        password: authPassword,
      });
      applyBackendConfig(backend);
      setAuthPassword("");
      setConnectionStatus("idle");
      setConnectionError("");
      await refreshSnapshot();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Login failed");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleOidcLogin(providerId: string) {
    setAuthSubmitting(true);
    setAuthError("");

    try {
      const backend = await loginWithOidc(providerId);
      applyBackendConfig(backend);
      setConnectionStatus("idle");
      setConnectionError("");
      await refreshSnapshot();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "OIDC login failed");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleSignOut() {
    console.info("[SlateAuth] Sign out initiated from Settings (renderer)");
    try {
      const backend = await signOutBackend();
      applyBackendConfig(backend);
      setAuthPassword("");
      setAuthError("");
      await refreshSnapshot();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to sign out");
    }
  }

  async function handleFullSync() {
    setBackendSyncing(true);
    try {
      await refreshSnapshot();
      toast.success("Refreshed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setBackendSyncing(false);
    }
  }

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
    setSelectedNoteId(noteId);
    setErrorMessage("");
    void setLastOpenNoteId(noteId);
    if (isFloatingSidebar) setSidebarCollapsed(true);

    try {
      const note = await loadNote(noteId);
      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      lastSavedRef.current = JSON.stringify({
        id: note.id,
        title: note.title,
      });
      setSelectedNote(note);
      setSaveState("saved");
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      setErrorMessage(error instanceof Error ? error.message : "Failed to open note");
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

  async function persistNote(note: LocalNoteSummary, plainText?: string) {
    try {
      lastSavedRef.current = JSON.stringify({ id: note.id, title: note.title });
      await saveNote({ id: note.id, title: note.title, markdown: "" });

      // Update plain_text for offline search (debounced via setTimeout above)
      if (plainText !== undefined) {
        void updateNotePlainText(note.id, plainText);
      }

      setSnapshot((current) => ({
        ...current,
        notes: current.notes
          .map((entry) =>
            entry.id === note.id
              ? { ...entry, title: note.title, updatedAt: new Date().toISOString() }
              : entry,
          )
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      }));

      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to save note");
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

  async function handleCreateNote(parentPath?: string) {
    setPendingCreation({ kind: "note", parentPath });
    setPendingCreationValue("Untitled");
  }

  async function confirmPendingCreation() {
    if (!pendingCreation) {
      return;
    }

    const name = pendingCreationValue.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }

    try {
      if (pendingCreation.kind === "note") {
        const targetPath =
          typeof pendingCreation.parentPath === "string" ? pendingCreation.parentPath : undefined;
        const note = await createNote(targetPath, name);

        const noteDir = note.path.includes("/")
          ? note.path.substring(0, note.path.lastIndexOf("/"))
          : "";
        const existingDuplicate = snapshot.notes.find(
          (n) =>
            n.title === note.title &&
            (n.path.includes("/") ? n.path.substring(0, n.path.lastIndexOf("/")) : "") === noteDir,
        );
        if (existingDuplicate) {
          toast.error(`A note named "${note.title}" already exists in this folder`);
        }

        await refreshSnapshot();
        await handleSelectNote(note.id);
      } else if (pendingCreation.kind === "template") {
        const note = await createTemplate(undefined, name);
        await refreshSnapshot();
        await handleSelectNote(note.id);
      } else {
        const targetPath =
          typeof pendingCreation.parentPath === "string" ? pendingCreation.parentPath : undefined;
        const folderPath = await createFolder(targetPath, name);
        await refreshSnapshot();
        setCollapsedPaths((current) => {
          const next = new Set(current);
          next.delete(folderPath);
          return next;
        });
      }
      setPendingCreation(null);
      setPendingCreationValue("");
    } catch (error) {
      const fallback =
        pendingCreation.kind === "folder"
          ? "Failed to create folder"
          : pendingCreation.kind === "template"
            ? "Failed to create template"
            : "Failed to create note";
      setErrorMessage(error instanceof Error ? error.message : fallback);
    }
  }

  async function handleCreateTemplate() {
    setPendingCreation({ kind: "template" });
    setPendingCreationValue("Untitled Template");
  }

  async function handleCreateDailyNote() {
    try {
      const note = await createDailyNote();
      await refreshSnapshot();
      await handleSelectNote(note.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create daily note");
    }
  }

  async function handleCreateFolder(parentPath?: string) {
    setPendingCreation({ kind: "folder", parentPath });
    setPendingCreationValue("New Folder");
  }

  async function handleMoveNote(noteId: string, targetFolderPath: string) {
    try {
      await flushPendingSave();
      await moveNote(noteId, targetFolderPath);
      await refreshSnapshot();
      if (selectedNoteId === noteId) {
        const loaded = await loadNote(noteId);
        setSelectedNote(loaded);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to move note");
    }
  }

  async function handleMoveFolder(folderPath: string, targetParentPath: string) {
    try {
      await flushPendingSave();
      await moveFolder(folderPath, targetParentPath);
      await refreshSnapshot();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to move folder");
    }
  }

  async function handleDeleteNote(noteId: string) {
    const note = snapshot.notes.find((n) => n.id === noteId);
    if (note) setDeletingNote({ id: noteId, path: note.path });
  }

  async function confirmDeleteNote() {
    if (!deletingNote) return;
    const noteId = deletingNote.id;
    setDeletingNote(null);
    try {
      await flushPendingSave();
      await deleteNote(noteId);
      const remainingNotes = snapshot.notes.filter((note) => note.id !== noteId);
      setSnapshot((current) => ({
        ...current,
        notes: remainingNotes,
      }));

      if (selectedNoteId === noteId) {
        setSelectedNoteId("");
        setSelectedNote(null);
        if (remainingNotes[0]) {
          await handleSelectNote(remainingNotes[0].id);
        }
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete note");
    }
  }

  async function handleTogglePin(noteId: string, pinned: boolean) {
    await togglePinNote(noteId, pinned);
    await refreshSnapshot();
  }

  function handleRenameFolder(folderPath: string, currentName: string) {
    setRenamingFolder({ path: folderPath, name: currentName });
    setRenamingValue(currentName);
  }

  function handleRenameNote(noteId: string, currentPath: string) {
    const currentName = displayNameFromPath(currentPath);
    setRenamingNote({ id: noteId, title: currentName });
    setRenamingNoteValue(currentName);
  }

  function handleRenameIcs(subscription: { id: string; name: string }) {
    setRenamingIcs(subscription);
    setRenamingIcsValue(subscription.name);
  }

  async function closeRenameFolderDialog() {
    setRenamingFolder(null);
  }

  async function closeRenameNoteDialog() {
    setRenamingNote(null);
    setRenamingNoteValue("");
  }

  async function confirmRenameFolder() {
    if (!renamingFolder) return;
    const nextName = renamingValue.trim();
    if (!nextName || nextName === renamingFolder.name) {
      setRenamingFolder(null);
      return;
    }

    try {
      await flushPendingSave();
      await renameFolder(renamingFolder.path, nextName);
      await refreshSnapshot();
      setRenamingFolder(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename folder");
    }
  }

  async function confirmRenameNote() {
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
      await renameNote(renamingNote.id, nextTitle);
      await refreshSnapshot();
      if (selectedNoteId === renamingNote.id) {
        const loaded = await loadNote(renamingNote.id);
        setSelectedNote(loaded);
      }
      await closeRenameNoteDialog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename note");
    }
  }

  async function closeRenameIcsDialog() {
    setRenamingIcs(null);
    setRenamingIcsValue("");
  }

  async function confirmRenameIcs() {
    if (!renamingIcs) return;
    const nextName = renamingIcsValue.trim();
    if (!nextName || nextName === renamingIcs.name) {
      await closeRenameIcsDialog();
      return;
    }

    try {
      await updateIcsSubscription({ id: renamingIcs.id, name: nextName });
      setCalendarStatus(await getCalendarStatus());
      setCalendarSidebarRefreshSignal((current) => current + 1);
      toast.success("ICS feed renamed");
      await closeRenameIcsDialog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename ICS feed");
    }
  }

  function handleDeleteFolder(folderPath: string) {
    setDeletingFolder(folderPath);
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
      { type: "separator" },
      { id: "new-template", label: "New Template" },
    ]);

    if (selected === "new-note") {
      void handleCreateNote();
    } else if (selected === "new-folder") {
      void handleCreateFolder();
    } else if (selected === "new-template") {
      void handleCreateTemplate();
    }
  }

  async function confirmDeleteFolder() {
    if (!deletingFolder) return;
    try {
      await flushPendingSave();
      await deleteFolder(deletingFolder);
      await refreshSnapshot();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete folder");
    }
    setDeletingFolder(null);
  }

  function updateSelectedNote(field: "title" | "markdown", value: string) {
    setSelectedNote((current) => {
      if (!current) return current;
      if (field === "markdown") {
        // Content lives in Y.Doc; we only update the title derived from markdown
        return { ...current, title: deriveDocumentTitle(value) };
      }
      return { ...current, [field]: value };
    });
  }

  function togglePath(path: string) {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  // --- Keyboard shortcuts ---

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
        setCommandBarOpen((prev) => !prev);
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

  async function handleUploadFile(file: File): Promise<{ id: string; contentUrl: string }> {
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

    // Resolve relative content URL to a fully-qualified URL the renderer can load
    const resolved = await resolveAttachmentUrl(result.contentUrl);
    return { id: result.id, contentUrl: resolved };
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

  useEffect(() => {
    if (snapshot.backend.authStatus !== "authenticated" || !snapshot.backend.backendReachable) {
      setCalendarStatus(null);
      return;
    }

    let cancelled = false;
    getCalendarStatus()
      .then((status) => {
        if (cancelled) return;
        setCalendarStatus(status);
      })
      .catch(() => {
        if (!cancelled) setCalendarStatus(null);
      });

    return () => {
      cancelled = true;
    };
  }, [snapshot.backend.authStatus, snapshot.backend.backendReachable]);

  useEffect(() => {
    if (!calendarStatus) return;

    const reconciled = reconcileCalendarVisibilityFilters(
      calendarStatus,
      calendarVisibilityFilters,
    );
    if (!filtersEqual(calendarVisibilityFilters, reconciled)) {
      setCalendarVisibilityFiltersState(reconciled);
      void setCalendarVisibilityFilters(reconciled);
    }
  }, [calendarStatus, calendarVisibilityFilters]);

  const notes = snapshot.notes;
  const selectedCalendarIds = useMemo(
    () =>
      calendarVisibilityFilters?.selectedCalendarIds ??
      (calendarStatus
        ? calendarStatus.connections.flatMap((connection) =>
            connection.calendars
              .filter((calendar) => calendar.enabled)
              .map((calendar) => calendar.subscriptionId),
          )
        : []),
    [calendarStatus, calendarVisibilityFilters],
  );
  const selectedIcsIds = useMemo(
    () =>
      calendarVisibilityFilters?.selectedIcsIds ??
      (calendarStatus
        ? calendarStatus.icsSubscriptions
            .filter((subscription) => subscription.enabled)
            .map((subscription) => subscription.id)
        : []),
    [calendarStatus, calendarVisibilityFilters],
  );
  const selectedProviderCalendarIds = useMemo(
    () =>
      calendarStatus
        ? calendarStatus.connections.flatMap((connection) =>
            connection.calendars
              .filter(
                (calendar) =>
                  calendar.enabled && selectedCalendarIds.includes(calendar.subscriptionId),
              )
              .map((calendar) => calendar.calendarId),
          )
        : [],
    [calendarStatus, selectedCalendarIds],
  );
  const calendarNameBySourceId = useMemo(() => {
    if (!calendarStatus) return {};

    return {
      ...Object.fromEntries(
        calendarStatus.connections.flatMap((connection) =>
          connection.calendars
            .filter((calendar) => calendar.enabled)
            .flatMap((calendar) => [
              [calendar.subscriptionId, calendar.name],
              [calendar.calendarId, calendar.name],
            ]),
        ),
      ),
      ...Object.fromEntries(
        calendarStatus.icsSubscriptions
          .filter((subscription) => subscription.enabled)
          .flatMap((subscription) => [[subscription.id, subscription.name]]),
      ),
    } as Record<string, string>;
  }, [calendarStatus]);
  const selectedCalendarIdSet = new Set(selectedCalendarIds);
  const selectedIcsIdSet = new Set(selectedIcsIds);
  const writableCalendars: CalendarInfo[] = useMemo(
    () =>
      calendarStatus
        ? calendarStatus.connections.flatMap((connection) =>
            connection.calendars.filter((calendar) => calendar.enabled),
          )
        : [],
    [calendarStatus],
  );
  const calendarReminderSources = useMemo(
    () =>
      calendarStatus
        ? [
            ...calendarStatus.connections.flatMap((connection) =>
              connection.calendars
                .filter((calendar) => calendar.enabled)
                .map((calendar) => ({
                  id: calendar.subscriptionId,
                  name: calendar.name,
                  color: calendar.color,
                })),
            ),
            ...calendarStatus.icsSubscriptions
              .filter((subscription) => subscription.enabled)
              .map((subscription) => ({
                id: subscription.id,
                name: subscription.name,
                color: subscription.color,
              })),
          ]
        : [],
    [calendarStatus],
  );
  const canCreateEvent =
    snapshot.backend.authStatus === "authenticated" &&
    snapshot.backend.backendReachable &&
    writableCalendars.length > 0;
  const tree = buildNoteTree(notes, snapshot.folders);
  const pinnedNotes = snapshot.notes.filter((n) => n.pinned);
  const notesLoading = appLoading;
  const syncStatus = !snapshot.backend.backendReachable
    ? { icon: WifiOff, label: "Offline" as const }
    : snapshot.backend.authStatus === "authenticating"
      ? {
          icon: Loader2,
          label: "Checking auth" as const,
          iconClassName: "[&_svg]:animate-spin" as const,
        }
      : snapshot.backend.authStatus !== "authenticated"
        ? { icon: LogIn, label: "Sign in required" as const }
        : saveState === "saving" || backendSyncing
          ? {
              icon: RefreshCw,
              label: "Syncing..." as const,
              iconClassName: "[&_svg]:animate-spin" as const,
            }
          : saveState === "error"
            ? {
                icon: AlertCircle,
                label: "Sync failed" as const,
                iconClassName: "text-red-400" as const,
              }
            : snapshot.backend.authStatus === "authenticated"
              ? { icon: Cloud, label: "Synced to cloud" as const }
              : { icon: HardDrive, label: "Saved locally" as const };
  const sidebarToggleLabel = sidebarCollapsed ? "Open left panel" : "Close left panel";
  const topBarShowsNavigation = mainPanelMode !== "calendar";

  function handleModeChange(mode: SidebarMode) {
    setSidebarMode(mode);
    if (mode !== "chat") {
      setMainPanelMode(mainPanelModeForSidebarMode(mode));
    }
    if (sidebarCollapsed && mode === "chat") setSidebarCollapsed(false);
  }

  function updateCalendarVisibilityFilters(next: CalendarVisibilityFilters) {
    setCalendarVisibilityFiltersState(next);
    void setCalendarVisibilityFilters(next);
  }

  function handleToggleCalendarVisibility(subscriptionId: string) {
    const nextSelectedCalendarIds = selectedCalendarIds.includes(subscriptionId)
      ? selectedCalendarIds.filter((id) => id !== subscriptionId)
      : [...selectedCalendarIds, subscriptionId];
    updateCalendarVisibilityFilters({
      selectedCalendarIds: nextSelectedCalendarIds,
      selectedIcsIds,
      knownCalendarIds:
        calendarVisibilityFilters?.knownCalendarIds ??
        writableCalendars.map((calendar) => calendar.subscriptionId),
      knownIcsIds:
        calendarVisibilityFilters?.knownIcsIds ??
        (calendarStatus?.icsSubscriptions ?? [])
          .filter((subscription) => subscription.enabled)
          .map((subscription) => subscription.id),
    });
  }

  function handleToggleIcsVisibility(id: string) {
    const nextSelectedIcsIds = selectedIcsIds.includes(id)
      ? selectedIcsIds.filter((entryId) => entryId !== id)
      : [...selectedIcsIds, id];
    updateCalendarVisibilityFilters({
      selectedCalendarIds,
      selectedIcsIds: nextSelectedIcsIds,
      knownCalendarIds:
        calendarVisibilityFilters?.knownCalendarIds ??
        writableCalendars.map((calendar) => calendar.subscriptionId),
      knownIcsIds:
        calendarVisibilityFilters?.knownIcsIds ??
        (calendarStatus?.icsSubscriptions ?? [])
          .filter((subscription) => subscription.enabled)
          .map((subscription) => subscription.id),
    });
  }
  const sidebarContent = (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden pl-2 pb-3 pt-3"
      onContextMenu={
        sidebarMode === "notes"
          ? (event) => void handleSidebarContextMenu(event)
          : (event) => event.preventDefault()
      }
    >
      {sidebarMode === "notes" && (
        <div className="mb-1.5 flex w-full max-w-full min-w-0 shrink-0 items-center justify-between text-[0.88rem] text-muted tracking-wide">
          <span
            className="text-[0.9rem] font-normal tracking-wide text-foreground"
            style={{ userSelect: "none" }}
          >
            Notes
          </span>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
                      aria-label="Create new note or folder"
                    >
                      <Plus size={14} />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">New note, daily note, or folder</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void handleCreateNote()}>
                  <FilePlus2 size={14} /> New note
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleCreateDailyNote()}>
                  <CalendarPlus size={14} /> Daily note
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleCreateFolder()}>
                  <FolderPlus size={14} /> New folder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void handleCreateTemplate()}>
                  <FileStack size={14} /> New template
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {sidebarMode === "calendar" ? (
        <CalendarSidebar
          backendReachable={snapshot.backend.backendReachable}
          backendAuthenticated={snapshot.backend.authStatus === "authenticated"}
          selectedCalendarIds={selectedCalendarIdSet}
          selectedIcsIds={selectedIcsIdSet}
          refreshSignal={calendarSidebarRefreshSignal}
          onToggleCalendarVisibility={handleToggleCalendarVisibility}
          onToggleIcsVisibility={handleToggleIcsVisibility}
          onStatusChange={setCalendarStatus}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAddIcs={() => setAddIcsOpen(true)}
          onOpenRenameIcs={handleRenameIcs}
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
            void handleSelectNote(docId);
          }}
          onOpenNoteInEditor={(docId) => {
            void handleSelectNote(docId);
          }}
        />
      ) : (
        <ScrollArea
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col",
            "[&_.ui-scroll-area__viewport]:overflow-x-hidden!",
            "[&_.ui-scroll-area__scrollbar--horizontal]:hidden",
            "[&_.ui-scroll-area__scrollbar--vertical]:hidden",
          )}
        >
          <div className="notes-tree grid min-h-full min-w-0 max-w-full gap-2 box-border pr-2">
            <PinnedSection
              notes={pinnedNotes}
              selectedNoteId={selectedNoteId}
              onSelectNote={handleSelectNote}
              onDeleteNote={handleDeleteNote}
              onTogglePin={handleTogglePin}
            />
            {tree.length === 0 ? (
              <div className="flex w-full justify-center px-4 py-3 text-[0.82rem] text-faint">
                No notes yet
              </div>
            ) : (
              <DndContext
                sensors={treeDndSensors}
                collisionDetection={pointerWithin}
                onDragEnd={handleTreeDragEnd}
              >
                <TreeSidebarDndHoverLock />
                {tree.map((node) => (
                  <TreeBranch
                    key={node.path || "root"}
                    node={node}
                    depth={0}
                    selectedNoteId={selectedNoteId}
                    onSelectNote={handleSelectNote}
                    onDeleteNote={handleDeleteNote}
                    onRenameNote={handleRenameNote}
                    onCreateNote={handleCreateNote}
                    onCreateFolder={handleCreateFolder}
                    onRenameFolder={handleRenameFolder}
                    onDeleteFolder={handleDeleteFolder}
                    onMoveNote={handleMoveNote}
                    onMoveFolder={handleMoveFolder}
                    collapsedPaths={collapsedPaths}
                    onTogglePath={togglePath}
                    onTogglePin={handleTogglePin}
                    onCreateTemplate={handleCreateTemplate}
                  />
                ))}
              </DndContext>
            )}
          </div>
        </ScrollArea>
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
          selectedCalendarIds={selectedCalendarIds}
          selectedProviderCalendarIds={selectedProviderCalendarIds}
          selectedIcsIds={selectedIcsIds}
          calendarNameBySourceId={calendarNameBySourceId}
          canCreateEvent={canCreateEvent}
          createEventDisabledReason={CREATE_EVENT_DISABLED_REASON}
          view={calendarView}
          onViewChange={setCalendarView}
          date={calendarDate}
          onDateChange={setCalendarDate}
          onCreateEvent={(slotInfo) => {
            if (Date.now() - createEventClosedAt.current < 300) return;
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
          refreshSignal={calendarViewRefreshSignal}
        />
      ) : (
        <>
          <SearchBar
            open={searchOpen}
            closing={searchClosing}
            query={searchQuery}
            index={searchIndex}
            count={searchCount}
            onQueryChange={handleSearchChange}
            onNavigate={navigateSearch}
            onClose={closeSearch}
            onReplace={handleReplace}
            onReplaceAll={handleReplaceAll}
            inputRef={searchInputRef}
          />
          <ScrollArea className="min-h-0 h-full flex-1 overflow-hidden">
            {selectedNote ? (
              <div className="editor-document h-full min-h-full px-11 pb-10 pt-[18px] max-md:px-6">
                <div className="relative">
                  <SyncProvider
                    noteId={selectedNoteId}
                    backendUrl={backendEndpoint ?? null}
                    getToken={async () => {
                      const token = await (window as any).slateDesktop.getSetting("accessToken");
                      return token ?? "";
                    }}
                  >
                    <EditorWithSync
                      onChange={(markdown) => updateSelectedNote("markdown", markdown)}
                      onUploadImage={handleUploadFile}
                    />
                  </SyncProvider>
                </div>

                {errorMessage ? (
                  <div className="mt-[18px] rounded-[14px] bg-[rgba(255,146,136,0.12)] px-3.5 py-3 text-[0.9rem] text-danger">
                    {errorMessage}
                  </div>
                ) : null}
              </div>
            ) : notesLoading ? (
              <div className="editor-document min-h-full px-11 pb-10 pt-[18px] max-md:px-6" />
            ) : snapshot.notes.length === 0 ? (
              <Welcome onCreateNote={() => void handleCreateNote()} />
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
        canGoBack,
        canGoForward,
        onGoBack: handleNavBack,
        onGoForward: handleNavForward,
        syncStatus,
      }}
      sidebarContent={sidebarContent}
      mainContent={mainContent}
    >
      <CommandBar
        open={commandBarOpen}
        notes={snapshot.notes}
        onSelect={(noteId) => {
          setCommandBarOpen(false);
          setMainPanelMode("notes");
          setSidebarMode("notes");
          void handleSelectNote(noteId);
        }}
        onClose={() => setCommandBarOpen(false)}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          if (open) {
            setBackendEndpointValue(snapshot.backend.endpoint);
            setConnectionStatus("idle");
            setConnectionError("");
            setAuthEmail(snapshot.backend.authenticatedEmail ?? "");
            setAuthPassword("");
            setAuthError("");
          }
          setSettingsOpen(open);
        }}
        snapshot={snapshot}
        backendEndpoint={backendEndpoint}
        onBackendEndpointChange={(value) => {
          setBackendEndpointValue(value);
          setConnectionStatus("idle");
          setConnectionError("");
          setAuthError("");
        }}
        connectionStatus={connectionStatus}
        connectionError={connectionError}
        authEmail={authEmail}
        authPassword={authPassword}
        onAuthEmailChange={setAuthEmail}
        onAuthPasswordChange={setAuthPassword}
        authSubmitting={authSubmitting}
        authError={authError}
        calendarReminderSettings={calendarReminderSettings}
        calendarReminderSources={calendarReminderSources}
        onCalendarReminderSettingsChange={updateCalendarReminderSettings}
        onTestConnection={handleTestConnection}
        onSaveEndpoint={handleSaveEndpoint}
        onLogin={handleLogin}
        onLoginWithOidc={handleOidcLogin}
        onCancelOidc={() => void cancelOidc()}
        onSignOut={handleSignOut}
        onFullSync={handleFullSync}
        fullSyncing={backendSyncing}
        onImportFolder={async () => {
          const result = await importFolder();
          if (result && result.imported > 0) {
            await refreshSnapshot();
          }
          return result;
        }}
      />

      <AddIcsDialog
        open={addIcsOpen}
        onOpenChange={setAddIcsOpen}
        onConfirm={async (url, name) => {
          try {
            await addIcsSubscription({ url, name });
            setCalendarStatus(await getCalendarStatus());
            setCalendarSidebarRefreshSignal((current) => current + 1);
            toast.success("ICS feed added");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to add ICS feed");
            throw error;
          }
        }}
      />

      <RenameIcsDialog
        open={renamingIcs !== null}
        onOpenChange={(open) => {
          if (!open) void closeRenameIcsDialog();
        }}
        subscription={renamingIcs}
        value={renamingIcsValue}
        onValueChange={setRenamingIcsValue}
        onConfirm={confirmRenameIcs}
      />

      <CreateEventDialog
        open={createEventOpen}
        onOpenChange={(open) => {
          if (!open) createEventClosedAt.current = Date.now();
          setCreateEventOpen(open);
        }}
        calendars={writableCalendars}
        initialStart={createEventSlot?.start}
        initialEnd={createEventSlot?.end}
        initialAllDay={createEventSlot?.allDay}
        onConfirm={async (data) => {
          try {
            await createCalendarEvent(data);
            setCalendarViewRefreshSignal((n) => n + 1);
            toast.success("Event created");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to create event");
            throw error;
          }
        }}
      />

      <EditEventDialog
        open={editEventOpen}
        onOpenChange={setEditEventOpen}
        event={editingEvent}
        onConfirm={async (data) => {
          try {
            await updateCalendarEvent(data);
            setCalendarViewRefreshSignal((n) => n + 1);
            toast.success("Event updated");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to update event");
            throw error;
          }
        }}
      />

      <RenameFolderDialog
        open={pendingCreation !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingCreation(null);
            setPendingCreationValue("");
          }
        }}
        title={
          pendingCreation?.kind === "folder"
            ? "Create folder"
            : pendingCreation?.kind === "template"
              ? "Create template"
              : "Create note"
        }
        description={
          pendingCreation?.kind === "folder"
            ? "Enter a name for this folder."
            : pendingCreation?.kind === "template"
              ? "Enter a name for this template."
              : "Enter a name for this note."
        }
        confirmLabel={
          pendingCreation?.kind === "folder"
            ? "Create folder"
            : pendingCreation?.kind === "template"
              ? "Create template"
              : "Create note"
        }
        value={pendingCreationValue}
        onValueChange={setPendingCreationValue}
        onConfirm={confirmPendingCreation}
        selectAllOnOpen
      />

      <RenameFolderDialog
        open={renamingFolder !== null}
        onOpenChange={(open) => {
          if (!open) void closeRenameFolderDialog();
        }}
        title="Rename"
        description="Enter a new name."
        confirmLabel="Rename"
        value={renamingValue}
        onValueChange={setRenamingValue}
        onConfirm={confirmRenameFolder}
      />

      <RenameFolderDialog
        open={renamingNote !== null}
        onOpenChange={(open) => {
          if (!open) void closeRenameNoteDialog();
        }}
        title="Rename"
        description="Enter a file name. Spaces are allowed."
        confirmLabel="Rename"
        value={renamingNoteValue}
        onValueChange={setRenamingNoteValue}
        validationMessage={renamingNote ? validatePathSegmentName(renamingNoteValue) : null}
        disableConfirm={Boolean(renamingNote && validatePathSegmentName(renamingNoteValue))}
        onConfirm={confirmRenameNote}
      />

      <DeleteFolderDialog
        open={deletingFolder !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingFolder(null);
        }}
        folderPath={deletingFolder}
        onConfirm={confirmDeleteFolder}
      />

      <DeleteNoteDialog
        open={deletingNote !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingNote(null);
        }}
        notePath={deletingNote?.path ?? null}
        onConfirm={confirmDeleteNote}
      />

      <Toaster
        theme="dark"
        position="bottom-center"
        toastOptions={{
          style: {
            background: "var(--panel-elevated)",
            border: "1px solid var(--line)",
            color: "var(--text)",
          },
        }}
      />
    </DesktopShell>
  );
}
