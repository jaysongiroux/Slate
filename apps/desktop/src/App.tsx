import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Calendar,
  CheckSquare,
  Cloud,
  GitBranch,
  HardDrive,
  HousePlug,
  Link,
  Loader2,
  LogIn,
  MessageSquare,
  PenSquare,
  RefreshCw,
  SquareKanban,
  StickyNote,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "./components/EmptyState";
import { NovelEditor } from "./components/NovelEditor";
import { ChatSidebar, type ChatSidebarHandle } from "./components/ChatSidebar";
import { CalendarSidebar } from "./components/CalendarSidebar";
import { CalendarView } from "./components/CalendarView";
import { NoteGraphView } from "./components/NoteGraphView";
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
import { useDatabase, useDatabaseReset } from "./db/DatabaseProvider";
import { useNotes } from "./hooks/use-notes";
import { useFolders } from "./hooks/use-folders";
import { useCalendarState, CREATE_EVENT_DISABLED_REASON } from "./hooks/useCalendarState";
import { useNoteSearch } from "./hooks/useNoteSearch";
import { useAppKeyboardShortcuts } from "./hooks/useAppKeyboardShortcuts";
import { useBackendActions } from "./hooks/useBackendActions";
import { useNoteActions } from "./hooks/useNoteActions";
import { useNavigation } from "./hooks/useNavigation";
import { useNavigationStore, type NavEntry } from "./stores/navigation-store";
import {
  addIcsSubscription,
  cancelOidc,
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
  getCalendarStatus,
  getNoteGraph,
  deleteNoteGraphEdges,
  enqueueNoteGraphRebuild,
  importFolder,
  importFiles,
} from "./lib/api";
import type { NoteGraphPayload } from "./lib/api/ipc-core";
import {
  NOTE_GRAPH_ENABLED_SETTING_KEY,
  CHECKLISTS_ENABLED_SETTING_KEY,
  CHECKLISTS_SELECTED_KEY,
  HOME_ASSISTANT_ENABLED_SETTING_KEY,
  LINKWARDEN_ENABLED_SETTING_KEY,
  JIRA_ENABLED_SETTING_KEY,
  DIAGRAMS_ENABLED_SETTING_KEY,
} from "@slate/shared";
import { useSetting } from "./hooks/use-settings";
import { getDatabase } from "./db/database";
import { insertImportedMarkdownNotes } from "./db/import-markdown";
import { ChecklistsSidebar } from "./components/ChecklistsSidebar";
import { ChecklistView } from "./components/ChecklistView";
import { useChecklists } from "./hooks/useChecklists";
import { useChecklistItems, type DerivedTaskItem } from "./hooks/useChecklistItems";
import { LinkwardenSidebar } from "./components/LinkwardenSidebar";
import { LinkwardenPanel } from "./components/LinkwardenPanel";
import { AddInstanceDialog } from "./components/linkwarden/AddInstanceDialog";
import { AddLinkDialog } from "./components/linkwarden/AddLinkDialog";
import { useLinkwardenStore } from "./stores/linkwarden-store";
import { AddHomeAssistantInstanceDialog } from "./components/home-assistant/AddHomeAssistantInstanceDialog";
import { HomeAssistantPanel } from "./components/home-assistant/HomeAssistantPanel";
import { HomeAssistantSidebar } from "./components/home-assistant/HomeAssistantSidebar";
import { useHomeAssistantStore } from "./stores/home-assistant-store";
import { JiraSidebar } from "./components/jira/JiraSidebar";
import { JiraPanel } from "./components/jira/JiraPanel";
import { AddJiraInstanceDialog } from "./components/jira/AddJiraInstanceDialog";
import { useJiraStore } from "./stores/jira-store";
import { useMcpStore } from "./stores/mcp-store";
import { DiagramsSidebar } from "./components/DiagramsSidebar";
import { DiagramEditor } from "./components/DiagramEditor";

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
  const [noteGraphEnabled] = useSetting<boolean>(db, NOTE_GRAPH_ENABLED_SETTING_KEY, false);
  const [checklistsEnabled] = useSetting<boolean>(db, CHECKLISTS_ENABLED_SETTING_KEY, false);
  const [linkwardenEnabled] = useSetting<boolean>(db, LINKWARDEN_ENABLED_SETTING_KEY, false);
  const [homeAssistantEnabled] = useSetting<boolean>(db, HOME_ASSISTANT_ENABLED_SETTING_KEY, false);
  const [jiraEnabled] = useSetting<boolean>(db, JIRA_ENABLED_SETTING_KEY, false);
  const [diagramsEnabled] = useSetting<boolean>(db, DIAGRAMS_ENABLED_SETTING_KEY, false);
  const { checklists, addChecklist, updateChecklist, deleteChecklist } = useChecklists(db);
  const [selectedChecklistId, setSelectedChecklistId] = useSetting<string>(
    db,
    CHECKLISTS_SELECTED_KEY,
    "",
  );
  const rxNotes = useNotes(db);
  const rxFolders = useFolders(db);

  const selectedChecklist = useMemo(
    () =>
      selectedChecklistId ? (checklists.find((c) => c.id === selectedChecklistId) ?? null) : null,
    [checklists, selectedChecklistId],
  );
  const checklistItems = useChecklistItems(rxNotes, selectedChecklist);

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
  const selectedDiagramId = useAppStore((s) => s.selectedDiagramId);
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
  const addLinkwardenInstanceOpen = useUiStore((s) => s.addLinkwardenInstanceOpen);
  const setAddLinkwardenInstanceOpen = useUiStore((s) => s.setAddLinkwardenInstanceOpen);
  const addLinkwardenLinkOpen = useUiStore((s) => s.addLinkwardenLinkOpen);
  const setAddLinkwardenLinkOpen = useUiStore((s) => s.setAddLinkwardenLinkOpen);
  const addHomeAssistantInstanceOpen = useUiStore((s) => s.addHomeAssistantInstanceOpen);
  const setAddHomeAssistantInstanceOpen = useUiStore((s) => s.setAddHomeAssistantInstanceOpen);
  const addJiraInstanceOpen = useUiStore((s) => s.addJiraInstanceOpen);
  const setAddJiraInstanceOpen = useUiStore((s) => s.setAddJiraInstanceOpen);

  const saveState = useSyncStore((s) => s.saveState);
  const backendSyncing = useSyncStore((s) => s.backendSyncing);
  const backendEndpoint = useSyncStore((s) => s.backendEndpoint);

  const noteGraphRailEligible =
    noteGraphEnabled &&
    snapshot.backend.authStatus === "authenticated" &&
    snapshot.backend.backendReachable;

  const checklistsRailEligible = checklistsEnabled;

  const linkwardenRailEligible =
    linkwardenEnabled &&
    snapshot.backend.authStatus === "authenticated" &&
    snapshot.backend.backendReachable;

  const homeAssistantRailEligible =
    homeAssistantEnabled &&
    snapshot.backend.authStatus === "authenticated" &&
    snapshot.backend.backendReachable;

  const jiraRailEligible =
    jiraEnabled &&
    snapshot.backend.authStatus === "authenticated" &&
    snapshot.backend.backendReachable;

  const diagramsRailEligible =
    diagramsEnabled &&
    snapshot.backend.authStatus === "authenticated" &&
    snapshot.backend.backendReachable;

  const enabledTabs = useMemo(() => {
    const tabs: { id: SidebarMode; label: string; icon: LucideIcon }[] = [
      { id: "notes", label: "Notes", icon: StickyNote },
      { id: "calendar", label: "Calendar", icon: Calendar },
      { id: "chat", label: "AI Chat", icon: MessageSquare },
    ];
    if (noteGraphRailEligible) tabs.push({ id: "graph", label: "Note Graph", icon: GitBranch });
    if (checklistsRailEligible)
      tabs.push({ id: "checklists", label: "Checklists", icon: CheckSquare });
    if (linkwardenRailEligible) tabs.push({ id: "linkwarden", label: "LinkWarden", icon: Link });
    if (homeAssistantRailEligible)
      tabs.push({ id: "home-assistant", label: "Home Assistant", icon: HousePlug });
    if (jiraRailEligible) tabs.push({ id: "jira", label: "Jira", icon: SquareKanban });
    if (diagramsRailEligible) tabs.push({ id: "diagrams", label: "Diagrams", icon: PenSquare });
    return tabs;
  }, [
    noteGraphRailEligible,
    checklistsRailEligible,
    linkwardenRailEligible,
    homeAssistantRailEligible,
    jiraRailEligible,
    diagramsRailEligible,
  ]);

  const [graphPayload, setGraphPayload] = useState<NoteGraphPayload | null>(null);
  const [graphDisabled, setGraphDisabled] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphRegenerating, setGraphRegenerating] = useState(false);

  const graphWasEligibleRef = useRef(false);
  useEffect(() => {
    if (noteGraphRailEligible) graphWasEligibleRef.current = true;
  }, [noteGraphRailEligible]);

  useEffect(() => {
    if (!graphWasEligibleRef.current) return;
    if (!noteGraphRailEligible && sidebarMode === "graph") {
      setSidebarMode("notes");
      setMainPanelMode("notes");
    }
  }, [noteGraphRailEligible, sidebarMode, setSidebarMode, setMainPanelMode]);

  const checklistsWasEnabledRef = useRef(false);
  useEffect(() => {
    if (checklistsRailEligible) checklistsWasEnabledRef.current = true;
  }, [checklistsRailEligible]);

  useEffect(() => {
    if (!checklistsWasEnabledRef.current) return;
    if (!checklistsRailEligible && sidebarMode === "checklists") {
      setSidebarMode("notes");
      setMainPanelMode("notes");
    }
  }, [checklistsRailEligible, sidebarMode, setSidebarMode, setMainPanelMode]);

  const linkwardenWasEligibleRef = useRef(false);
  useEffect(() => {
    if (linkwardenRailEligible) linkwardenWasEligibleRef.current = true;
  }, [linkwardenRailEligible]);

  useEffect(() => {
    if (!linkwardenWasEligibleRef.current) return;
    if (!linkwardenRailEligible && sidebarMode === "linkwarden") {
      setSidebarMode("notes");
      setMainPanelMode("notes");
    }
  }, [linkwardenRailEligible, sidebarMode, setSidebarMode, setMainPanelMode]);

  const homeAssistantWasEligibleRef = useRef(false);
  useEffect(() => {
    if (homeAssistantRailEligible) homeAssistantWasEligibleRef.current = true;
  }, [homeAssistantRailEligible]);

  useEffect(() => {
    if (!homeAssistantWasEligibleRef.current) return;
    if (!homeAssistantRailEligible && sidebarMode === "home-assistant") {
      setSidebarMode("notes");
      setMainPanelMode("notes");
    }
  }, [homeAssistantRailEligible, sidebarMode, setSidebarMode, setMainPanelMode]);

  const jiraWasEligibleRef = useRef(false);
  useEffect(() => {
    if (jiraRailEligible) jiraWasEligibleRef.current = true;
  }, [jiraRailEligible]);

  useEffect(() => {
    if (!jiraWasEligibleRef.current) return;
    if (!jiraRailEligible && sidebarMode === "jira") {
      setSidebarMode("notes");
      setMainPanelMode("notes");
    }
  }, [jiraRailEligible, sidebarMode, setSidebarMode, setMainPanelMode]);

  const diagramsWasEligibleRef = useRef(false);
  useEffect(() => {
    if (diagramsRailEligible) diagramsWasEligibleRef.current = true;
  }, [diagramsRailEligible]);

  useEffect(() => {
    if (!diagramsWasEligibleRef.current) return;
    if (!diagramsRailEligible && sidebarMode === "diagrams") {
      setSidebarMode("notes");
      setMainPanelMode("notes");
    }
  }, [diagramsRailEligible, sidebarMode, setSidebarMode, setMainPanelMode]);

  useEffect(() => {
    if (sidebarMode !== "graph") return;
    let cancelled = false;
    setGraphLoading(true);
    setGraphError(null);
    setGraphDisabled(false);
    void getNoteGraph()
      .then((payload) => {
        if (cancelled) return;
        if (payload === null) {
          setGraphPayload(null);
          setGraphDisabled(true);
        } else {
          setGraphPayload(payload);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setGraphError(err instanceof Error ? err.message : String(err));
          setGraphPayload(null);
        }
      })
      .finally(() => {
        if (!cancelled) setGraphLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    sidebarMode,
    snapshot.backend.authStatus,
    snapshot.backend.backendReachable,
    noteGraphEnabled,
  ]);

  const handleRegenerateGraph = useCallback(async () => {
    setGraphRegenerating(true);
    try {
      await deleteNoteGraphEdges();
      await enqueueNoteGraphRebuild();
      // Poll for the rebuilt graph (the rebuild job runs async in the backend)
      const poll = async (retries: number) => {
        for (let i = 0; i < retries; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const payload = await getNoteGraph();
          if (payload && payload.edges.length > 0) {
            setGraphPayload(payload);
            return;
          }
        }
        // Final fetch even if edges are still empty
        const payload = await getNoteGraph();
        if (payload) setGraphPayload(payload);
      };
      await poll(15);
    } catch (err) {
      setGraphError(err instanceof Error ? err.message : String(err));
    } finally {
      setGraphRegenerating(false);
    }
  }, []);

  const handleToggleChecklistItem = useCallback(
    async (item: DerivedTaskItem) => {
      const database = db ?? (await getDatabase());
      const noteDoc = await database.notes.findOne({ selector: { id: item.noteId } }).exec();
      if (!noteDoc) return;

      const noteData = noteDoc.toJSON();
      const json = JSON.parse(JSON.stringify(noteData.content));
      const taskList = json.content?.[item.taskListIndex];
      if (!taskList || taskList.type !== "taskList") return;
      const taskItem = taskList.content?.[item.taskItemIndex];
      if (!taskItem || taskItem.type !== "taskItem") return;

      const newChecked = !item.checked;
      taskItem.attrs = { ...taskItem.attrs, checked: newChecked };

      // Update markdown by finding and replacing the specific checkbox
      let markdown = noteData.markdown;
      const checkboxPattern = item.checked ? /- \[x\] /g : /- \[ \] /g;
      const replacement = newChecked ? "- [x] " : "- [ ] ";
      let match: RegExpExecArray | null;
      while ((match = checkboxPattern.exec(markdown)) !== null) {
        const afterCheckbox = markdown.slice(match.index + match[0].length);
        const lineEnd = afterCheckbox.indexOf("\n");
        const lineText = lineEnd >= 0 ? afterCheckbox.slice(0, lineEnd) : afterCheckbox;
        if (lineText.trim() === item.text.trim()) {
          markdown =
            markdown.slice(0, match.index) +
            replacement +
            markdown.slice(match.index + match[0].length);
          break;
        }
      }

      await noteDoc.patch({
        content: json,
        markdown,
        updatedAt: new Date().toISOString(),
      });
    },
    [db],
  );

  const [linkwardenRefreshSignal, setLinkwardenRefreshSignal] = useState(0);
  const [homeAssistantRefreshSignal, setHomeAssistantRefreshSignal] = useState(0);
  const [jiraRefreshSignal, setJiraRefreshSignal] = useState(0);
  const refreshLinks = useLinkwardenStore((s) => s.refreshLinks);

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
  const resetFromServer = useDatabaseReset();
  const backendActions = useBackendActions({
    handleSelectNote: stableHandleSelectNote,
    flushPendingSave: stableFlushPendingSave,
    setCalendarVisibilityFiltersState: calendar.setCalendarVisibilityFiltersState,
    setCalendarReminderSettingsState: calendar.setCalendarReminderSettingsState,
    DEFAULT_CALENDAR_REMINDER_SETTINGS: calendar.DEFAULT_CALENDAR_REMINDER_SETTINGS,
    resetFromServer,
  });

  // Wire up the refs now that both hooks are initialized
  refreshSnapshotRef.current = backendActions.refreshSnapshot;
  handleSelectNoteRef.current = noteActions.handleSelectNote;
  flushPendingSaveRef.current = noteActions.flushPendingSave;

  // --- Navigation ---
  const applyNavEntry = useCallback(
    (entry: NavEntry) => {
      if (entry.type === "note") {
        setSidebarMode("notes");
        setMainPanelMode("notes");
        void noteActions.handleSelectNote(entry.noteId);
      } else if (entry.type === "jira") {
        setSidebarMode("jira");
        setMainPanelMode("jira");
        const jira = useJiraStore.getState();
        if (entry.issueKey) {
          jira.setSelectedIssueKey(entry.issueKey);
        } else if (entry.projectKey) {
          jira.setSelectedProject(entry.projectKey ?? null);
        } else {
          jira.setView("projects");
          // Reset to projects view without clearing instance
          useJiraStore.setState({
            selectedProjectKey: null,
            selectedIssueKey: null,
            view: "projects",
          });
        }
      } else if (entry.type === "homeAssistant") {
        setSidebarMode("home-assistant");
        setMainPanelMode("home-assistant");
        useHomeAssistantStore.setState({
          selectedInstanceId: entry.instanceId,
          selectedDashboardId: entry.dashboardId ?? null,
          selectedBrowseMode: entry.browseMode,
          selectedAreaId: entry.areaId ?? null,
          selectedDeviceId: entry.deviceId ?? null,
        });
      } else if (entry.type === "mode" && entry.mode === "chat") {
        setSidebarMode("chat");
      } else if (entry.type === "mode") {
        setSidebarMode(entry.mode);
        setMainPanelMode(mainPanelModeForSidebarMode(entry.mode));
      }
    },
    [setSidebarMode, setMainPanelMode],
  );
  const navigation = useNavigation(applyNavEntry);

  // Push initial note to nav history so back/forward works from the start
  const hasInitializedNav = useRef(false);
  useEffect(() => {
    if (hasInitializedNav.current || !selectedNoteId) return;
    hasInitializedNav.current = true;
    const { entries, currentIndex } = useNavigationStore.getState();
    const current = entries[currentIndex];
    if (!current || !(current.type === "note" && current.noteId === selectedNoteId)) {
      useNavigationStore.getState().push({ type: "note", noteId: selectedNoteId });
    }
  }, [selectedNoteId]);

  /** Navigate to a note and push to history. Use for all user-initiated note selections. */
  async function selectNoteWithNav(noteId: string) {
    navigation.push({ type: "note", noteId });
    setSidebarMode("notes");
    setMainPanelMode("notes");
    await noteActions.handleSelectNote(noteId);
  }

  // --- Keyboard shortcuts ---
  const { getShortcut } = useAppKeyboardShortcuts({
    toggleSidebar,
    handleModeChange,
    handleCreateNote: noteActions.handleCreateNote,
    setCreateEventOpen,
    setSearchOpen: useUiStore.getState().setSearchOpen,
    searchInputRef: search.searchInputRef,
    goBack: navigation.goBack,
    goForward: navigation.goForward,
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

  // MCP store lifecycle — only run when authenticated to avoid 401 polling spam
  useEffect(() => {
    if (snapshot.backend.authStatus !== "authenticated") return;
    const store = useMcpStore.getState();
    void store.loadServers();
    store.startPolling();
    return () => store.stopPolling();
  }, [snapshot.backend.authStatus]);

  // Deep-link helper: allows badge popover (Task 19) to open Settings → AI → focused server
  useEffect(() => {
    (
      window as unknown as { slateOpenSettingsToMcp?: (id: string) => void }
    ).slateOpenSettingsToMcp = (serverId: string) => {
      useUiStore.getState().setSettingsFocus(`mcp:${serverId}`);
      useUiStore.getState().setSettingsOpen(true);
    };
    return () => {
      delete (window as unknown as { slateOpenSettingsToMcp?: (id: string) => void })
        .slateOpenSettingsToMcp;
    };
  }, []);

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
    if (snapshot.backend.authStatus === "authenticated") return { icon: Cloud, label: "" as const };
    return { icon: HardDrive, label: "Saved locally" as const };
  }, [snapshot.backend.backendReachable, snapshot.backend.authStatus, saveState, backendSyncing]);

  const sidebarToggleLabel = sidebarCollapsed ? "Open left panel" : "Close left panel";
  const topBarShowsNavigation = true;
  const hideLeftSidebar = sidebarMode === "graph";
  const effectiveShellColumns =
    hideLeftSidebar && !isFloatingSidebar
      ? "var(--icon-rail-width) minmax(0, 1fr)"
      : hideLeftSidebar && isFloatingSidebar
        ? "var(--icon-rail-width) minmax(0, 1fr)"
        : desktopShellColumns;
  const graphMainPanelStyle = hideLeftSidebar
    ? ({ gridColumn: "2", gridRow: "1" } as React.CSSProperties)
    : mainPanelGridStyle;

  function handleModeChange(mode: SidebarMode) {
    // Push to nav history for content view changes (not chat sidebar toggles)
    if (mode !== "chat") {
      if (mode === "notes" && selectedNoteId) {
        navigation.push({ type: "note", noteId: selectedNoteId });
      } else if (mode === "jira") {
        navigation.push({ type: "jira" });
      } else {
        navigation.push({ type: "mode", mode });
      }
    }

    setSidebarMode(mode);
    if (mode !== "chat") {
      setMainPanelMode(mainPanelModeForSidebarMode(mode));
    }
    if (sidebarCollapsed) setSidebarCollapsed(false);
  }

  // --- JSX ---

  const sidebarContent = appLoading ? (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" />
  ) : (
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
          showDailyNotesOnCalendar={calendar.showDailyNotesOnCalendar}
          onToggleDailyNotesVisibility={calendar.handleToggleDailyNotesVisibility}
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
            selectNoteWithNav(docId);
          }}
          onOpenNoteInEditor={(docId) => {
            selectNoteWithNav(docId);
          }}
        />
      ) : sidebarMode === "linkwarden" ? (
        <LinkwardenSidebar
          backendReachable={snapshot.backend.backendReachable}
          backendAuthenticated={snapshot.backend.authStatus === "authenticated"}
          refreshSignal={linkwardenRefreshSignal}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : sidebarMode === "home-assistant" ? (
        <HomeAssistantSidebar
          backendReachable={snapshot.backend.backendReachable}
          backendAuthenticated={snapshot.backend.authStatus === "authenticated"}
          refreshSignal={homeAssistantRefreshSignal}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : sidebarMode === "jira" ? (
        <JiraSidebar
          backendReachable={snapshot.backend.backendReachable}
          backendAuthenticated={snapshot.backend.authStatus === "authenticated"}
          refreshSignal={jiraRefreshSignal}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : sidebarMode === "checklists" ? (
        <ChecklistsSidebar
          checklists={checklists}
          selectedChecklistId={selectedChecklistId}
          onSelectChecklist={setSelectedChecklistId}
          onAddChecklist={addChecklist}
          onUpdateChecklist={updateChecklist}
          onDeleteChecklist={deleteChecklist}
        />
      ) : sidebarMode === "diagrams" ? (
        <DiagramsSidebar />
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
          onSelectNote={selectNoteWithNav}
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
      {sidebarMode === "graph" ? (
        <NoteGraphView
          className="h-full min-h-0"
          data={graphDisabled || graphError ? null : graphPayload}
          loading={graphLoading || appLoading}
          error={
            graphDisabled
              ? "Note graph is off for your account. Enable it in Settings → Extensions."
              : graphError
          }
          onSelectNote={(noteId) => {
            selectNoteWithNav(noteId);
          }}
          onRegenerateGraph={() => void handleRegenerateGraph()}
          regenerating={graphRegenerating}
        />
      ) : mainPanelMode === "calendar" ? (
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
          noteSummaries={rxNotes}
          showDailyNotesOnCalendar={calendar.showDailyNotesOnCalendar}
          onOpenDailyNoteFromCalendar={(noteId) => {
            selectNoteWithNav(noteId);
          }}
        />
      ) : mainPanelMode === "linkwarden" ? (
        <LinkwardenPanel />
      ) : mainPanelMode === "home-assistant" ? (
        <HomeAssistantPanel refreshSignal={homeAssistantRefreshSignal} />
      ) : mainPanelMode === "jira" ? (
        <JiraPanel />
      ) : mainPanelMode === "checklists" ? (
        <ChecklistView
          checklist={selectedChecklist}
          items={checklistItems}
          loading={appLoading}
          onToggleItem={handleToggleChecklistItem}
          onOpenNote={(noteId) => {
            selectNoteWithNav(noteId);
          }}
        />
      ) : mainPanelMode === "diagrams" ? (
        <DiagramEditor diagramId={selectedDiagramId} />
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
          <ScrollArea className="note-scroll-area min-h-0 h-full flex-1 overflow-hidden [&_.ui-scroll-area__scrollbar--horizontal]:hidden [&_.ui-scroll-area__scrollbar--vertical]:hidden">
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
      desktopShellColumns={effectiveShellColumns}
      isFloatingSidebar={isFloatingSidebar}
      sidebarCollapsed={sidebarCollapsed}
      sidebarTransitionDisabled={sidebarTransitionDisabled}
      floatingSidebarWidth={floatingSidebarWidth}
      mainPanelGridStyle={graphMainPanelStyle}
      hideLeftSidebar={hideLeftSidebar}
      showNoteGraphRail={noteGraphRailEligible}
      showChecklists={checklistsRailEligible}
      showLinkwarden={linkwardenRailEligible}
      showHomeAssistant={homeAssistantRailEligible}
      showJira={jiraRailEligible}
      showDiagrams={diagramsRailEligible}
      appLoading={appLoading}
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
        canGoBack: navigation.canGoBack,
        canGoForward: navigation.canGoForward,
        onGoBack: navigation.goBack,
        onGoForward: navigation.goForward,
        backShortcut: getShortcut("nav-back"),
        forwardShortcut: getShortcut("nav-forward"),
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
        enabledTabs={enabledTabs}
        onTabSelect={handleModeChange}
        linkwardenEnabled={linkwardenRailEligible}
        jiraEnabled={jiraRailEligible}
        onCommandBarSelect={(noteId) => {
          selectNoteWithNav(noteId);
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
        onResetFromServer={backendActions.handleResetFromServer}
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
      <AddInstanceDialog
        open={addLinkwardenInstanceOpen}
        onOpenChange={setAddLinkwardenInstanceOpen}
        onAdded={() => setLinkwardenRefreshSignal((n) => n + 1)}
      />
      <AddLinkDialog
        open={addLinkwardenLinkOpen}
        onOpenChange={setAddLinkwardenLinkOpen}
        onAdded={() => refreshLinks()}
      />
      <AddHomeAssistantInstanceDialog
        open={addHomeAssistantInstanceOpen}
        onOpenChange={setAddHomeAssistantInstanceOpen}
        onAdded={() => setHomeAssistantRefreshSignal((signal) => signal + 1)}
      />
      <AddJiraInstanceDialog
        open={addJiraInstanceOpen}
        onOpenChange={setAddJiraInstanceOpen}
        onAdded={() => setJiraRefreshSignal((s) => s + 1)}
      />
    </DesktopShell>
  );
}
