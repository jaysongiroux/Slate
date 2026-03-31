import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { DesktopSnapshot, LocalNoteSummary } from "@slate/shared";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  PanelLeft,
  CalendarPlus,
  Cloud,
  FilePlus2,
  FolderPlus,
  GripVertical,
  HardDrive,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { Button } from "./components/ui/button";
import { DeleteFolderDialog } from "./components/DeleteFolderDialog";
import { DeleteNoteDialog } from "./components/DeleteNoteDialog";
import { EmptyState } from "./components/EmptyState";
import { MilkdownEditor, type MilkdownEditorHandle } from "./components/MilkdownEditor";
import { TreeBranch, PinnedSection, TreeSidebarDndHoverLock } from "./components/NoteTree";
import { RenameFolderDialog } from "./components/RenameFolderDialog";
import { ChatSidebar, type ChatSidebarHandle } from "./components/ChatSidebar";
import { CommandBar } from "./components/CommandBar";
import { SearchBar } from "./components/SearchBar";
import { SettingsDialog, type ConnectionStatus } from "./components/SettingsDialog";
import { Welcome } from "./components/Welcome";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import { ScrollArea } from "./components/ui/scroll-area";
import { buildNoteTree } from "./lib/noteTree";
import {
  readStoredSidebarCollapsed,
  readStoredSidebarWidth,
  writeStoredSidebarCollapsed,
  writeStoredSidebarWidth,
} from "./lib/sidebarPreferences";
import { cn } from "./lib/utils";
import { parseDndActiveKind, parseDndDropTargetId } from "./lib/noteTreeDnd";
import { useKeyboardShortcuts, matchesShortcut } from "./lib/shortcuts";
import { YDocProvider, useYDoc } from "./lib/ydoc-context";
import {
  cancelOidc,
  checkBackendConnection,
  chooseWorkspaceDirectory,
  createDailyNote,
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  togglePinNote,
  rescanNote,
  fullSync,
  getLastOpenNoteId,
  getSnapshot,
  loginWithOidc,
  loginWithPassword,
  loadNote,
  moveNote,
  moveFolder,
  refreshBackendStatus,
  renameFolder,
  resolveAttachmentUrl,
  saveNote,
  setBackendEndpoint,
  setLastOpenNoteId,
  showContextMenu,
  signOutBackend,
  uploadAttachment,
} from "./lib/api";

const DEFAULT_SIDEBAR_WIDTH = 320;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 480;
const XS_SIDEBAR_BREAKPOINT = 760;
const BACKEND_STATUS_POLL_MS = 15000;

function titleFromMarkdown(markdown: string, fallbackTitle: string) {
  const heading = markdown
    .split("\n")
    .find((line) => line.startsWith("# "))
    ?.replace(/^#\s+/, "")
    .trim();

  return heading || fallbackTitle;
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
    workspace: {
      id: "loading",
      name: "Slate",
      rootPath: "~/Documents/Slate",
      connected: false,
    },
    backend: {
      endpoint: "localhost:50051",
      clientId: "loading",
      backendReachable: false,
      authStatus: "signed_out",
      authProviders: [],
    },
    notes: [],
    folders: [],
  };
}

function WindowControls({ visible }: { visible: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center overflow-hidden [-webkit-app-region:no-drag]",
        "transition-[width,opacity,transform,margin] duration-180 ease-out motion-reduce:transition-none",
        visible ? "mr-1 w-[63px] translate-x-0 opacity-100" : "mr-0 w-0 -translate-x-1 opacity-0 pointer-events-none",
      )}
      aria-hidden={!visible}
    >
      <div className="flex gap-3" aria-hidden="true">
        <span className="size-[13px] rounded-full bg-[#ff5f57]" />
        <span className="size-[13px] rounded-full bg-[#febc2e]" />
        <span className="size-[13px] rounded-full bg-[#28c840]" />
      </div>
    </div>
  );
}

function EditorWithYDoc({
  selectedNote,
  editorHandleRef,
  onChange,
  onUploadFile,
  onRejectFile,
  resolveImageUrl,
  onTableContextMenu,
  notes,
  currentNoteId,
  onNavigateNote,
}: {
  selectedNote: LocalNoteSummary;
  editorHandleRef: React.RefObject<MilkdownEditorHandle | null>;
  onChange: (markdown: string) => void;
  onUploadFile: (file: File) => Promise<{ id: string; contentUrl: string }>;
  onRejectFile: (file: File) => void;
  resolveImageUrl: (src: string) => Promise<string>;
  onTableContextMenu: () => Promise<any>;
  notes: LocalNoteSummary[];
  currentNoteId: string;
  onNavigateNote: (noteId: string) => void;
}) {
  const { yFragment, isReady } = useYDoc();

  if (!isReady) {
    return <div className="min-h-[68vh]" aria-hidden />;
  }

  return (
    <MilkdownEditor
      ref={editorHandleRef}
      key={`${selectedNote.id}-crdt`}
      value={selectedNote.markdown}
      yFragment={yFragment}
      onChange={onChange}
      onUploadFile={onUploadFile}
      onRejectFile={onRejectFile}
      resolveImageUrl={resolveImageUrl}
      onTableContextMenu={onTableContextMenu}
      notes={notes}
      currentNoteId={selectedNote.id}
      onNavigateNote={onNavigateNote}
    />
  );
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
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<{ path: string; name: string } | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [renamingSelectAllOnOpen, setRenamingSelectAllOnOpen] = useState(false);
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
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredSidebarWidth(window.localStorage, DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readStoredSidebarCollapsed(window.localStorage));

  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<'notes' | 'chat'>('notes');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchClosing, setSearchClosing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchCount, setSearchCount] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [sidebarTransitionDisabled, setSidebarTransitionDisabled] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const editorHandleRef = useRef<MilkdownEditorHandle | null>(null);
  const chatSidebarRef = useRef<ChatSidebarHandle | null>(null);
  const lastPolledBackendFingerprintRef = useRef<string | null>(null);
  const sidebarWasFloatingRef = useRef(window.innerWidth <= XS_SIDEBAR_BREAKPOINT);
  const sidebarCollapsedRef = useRef(readStoredSidebarCollapsed(window.localStorage));

  const loadRequestIdRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedRef = useRef("");
  const selectedNoteRef = useRef<LocalNoteSummary | null>(null);
  const resizingRef = useRef(false);
  const navHistoryRef = useRef<string[]>([]);
  const navIndexRef = useRef(-1);
  const navSkipPushRef = useRef(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  selectedNoteRef.current = selectedNote;

  const { getShortcut } = useKeyboardShortcuts();

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
    const api = (window as any).slateDesktop;
    if (!api?.onSyncStatus) return;
    api.onSyncStatus((status: string) => {
      setBackendSyncing(status === "syncing");
    });
    return () => api.offSyncStatus?.();
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const nextWidth = window.innerWidth;
      const wasFloating = sidebarWasFloatingRef.current;
      const willBeFloating = nextWidth <= XS_SIDEBAR_BREAKPOINT;

      if (willBeFloating && !wasFloating && !sidebarCollapsedRef.current) {
        flushSync(() => {
          setSidebarTransitionDisabled(true);
          setSidebarCollapsed(true);
          setViewportWidth(nextWidth);
        });
        sidebarCollapsedRef.current = true;
        resizingRef.current = false;
        document.body.classList.remove("is-resizing");
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            setSidebarTransitionDisabled(false);
          });
        });
      } else {
        flushSync(() => {
          setViewportWidth(nextWidth);
        });
      }

      sidebarWasFloatingRef.current = willBeFloating;
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    sidebarCollapsedRef.current = sidebarCollapsed;
  }, [sidebarCollapsed]);

  useEffect(() => {
    const api = (window as any).slateDesktop;
    if (!api?.onWorkspaceChanged) return;

    let lastUnsavedNoticeAt = 0;
    api.onWorkspaceChanged((diskRelPaths: string[]) => {
      const paths = Array.isArray(diskRelPaths) ? diskRelPaths : [];
      const current = selectedNoteRef.current;
      if (current && paths.length > 0) {
        const norm = (p: string) => p.replace(/\\/g, "/");
        const openPath = norm(current.path);
        const touchedOpenNote = paths.some((p) => norm(p) === openPath);
        if (touchedOpenNote) {
          const serialized = JSON.stringify({
            id: current.id,
            title: current.title,
            markdown: current.markdown,
          });
          if (serialized !== lastSavedRef.current) {
            const now = Date.now();
            if (now - lastUnsavedNoticeAt > 3000) {
              toast("This note changed on disk. Save or reload to resolve differences.");
              lastUnsavedNoticeAt = now;
            }
          }
        }
      }
      void refreshSnapshot();
    });

    return () => api.offWorkspaceChanged?.();
  }, []);

  useEffect(() => {
    writeStoredSidebarWidth(window.localStorage, sidebarWidth);
  }, [sidebarWidth]);

  useEffect(() => {
    writeStoredSidebarCollapsed(window.localStorage, sidebarCollapsed);
  }, [sidebarCollapsed]);

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
      markdown: selectedNote.markdown,
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
    const handlePointerMove = (event: PointerEvent) => {
      if (!resizingRef.current) {
        return;
      }

      setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, event.clientX)));
    };

    const handlePointerUp = () => {
      resizingRef.current = false;
      document.body.classList.remove("is-resizing");
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void updateBackendStatus();
    }, BACKEND_STATUS_POLL_MS);

    // Do not call updateBackendStatus on every window focus — it blocks on main-process gRPC
    // and stacks with Electron "activate" sync, which freezes the UI when alt-tabbing.

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  async function initializeApp() {
    try {
      const [nextSnapshot, lastNoteId] = await Promise.all([
        getSnapshot(),
        getLastOpenNoteId(),
      ]);
      setSnapshot(nextSnapshot);
      lastPolledBackendFingerprintRef.current = stableBackendFingerprint(nextSnapshot.backend);
      if (!settingsOpen) {
        setBackendEndpointValue(nextSnapshot.backend.endpoint);
      }

      const targetId = lastNoteId && nextSnapshot.notes.some((n) => n.id === lastNoteId)
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
      await checkBackendConnection(endpoint);
      setConnectionStatus("success");
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
      setConnectionError(refreshedBackend.backendReachable ? "" : "Saved, but the backend is offline.");
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
      await fullSync();
      await refreshSnapshot();
      toast.success("Full sync complete");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Full sync failed");
    } finally {
      setBackendSyncing(false);
    }
  }

  async function handleChooseWorkspace() {
    try {
      setWorkspaceLoading(true);
      setWorkspaceStatus("Selecting folder...");
      const workspace = await chooseWorkspaceDirectory();
      setWorkspaceStatus(`Loading notes from ${workspace.rootPath}...`);
      setSelectedNoteId("");
      setSelectedNote(null);
      setCollapsedPaths(new Set());
      await refreshSnapshot();
      setWorkspaceStatus("Workspace loaded.");
      window.setTimeout(() => {
        setWorkspaceLoading(false);
        setSettingsOpen(false);
        setWorkspaceStatus("");
      }, 500);
    } catch (error) {
      setWorkspaceLoading(false);
      setWorkspaceStatus("");
      setErrorMessage(error instanceof Error ? error.message : "Failed to change workspace");
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

    try {
      const note = await loadNote(noteId);
      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      lastSavedRef.current = JSON.stringify({
        id: note.id,
        title: note.title,
        markdown: note.markdown,
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

  async function persistNote(note: LocalNoteSummary) {
    try {
      const saved = await saveNote({
        id: note.id,
        title: note.title,
        markdown: note.markdown,
      });

      lastSavedRef.current = JSON.stringify({
        id: saved.id,
        title: saved.title,
        markdown: saved.markdown,
      });

      setSnapshot((current) => ({
        ...current,
        notes: current.notes
          .map((entry) => (entry.id === saved.id ? saved : entry))
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      }));

      if (selectedNoteRef.current?.id === saved.id) {
        setSelectedNote(saved);
      }

      setSaveState("saved");

      const prevNote = snapshot.notes.find((n) => n.id === saved.id);
      if (prevNote && prevNote.title !== saved.title) {
        const savedDir = saved.path.includes("/") ? saved.path.substring(0, saved.path.lastIndexOf("/")) : "";
        const duplicate = snapshot.notes.find(
          (n) =>
            n.id !== saved.id &&
            n.title === saved.title &&
            (n.path.includes("/") ? n.path.substring(0, n.path.lastIndexOf("/")) : "") === savedDir,
        );
        if (duplicate) {
          toast.error(`A note named "${saved.title}" already exists in this folder`);
        }
      }
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
      markdown: current.markdown,
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
    try {
      const targetPath = typeof parentPath === "string" ? parentPath : undefined;
      const note = await createNote(targetPath);

      const noteDir = note.path.includes("/") ? note.path.substring(0, note.path.lastIndexOf("/")) : "";
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
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create note");
    }
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
    try {
      const targetPath = typeof parentPath === "string" ? parentPath : undefined;
      const folderPath = await createFolder(targetPath);
      await refreshSnapshot();
      setCollapsedPaths((current) => {
        const next = new Set(current);
        next.delete(folderPath);
        return next;
      });
      const folderName = folderPath.split("/").pop() ?? "untitled-folder";
      setRenamingFolder({ path: folderPath, name: folderName });
      setRenamingValue(folderName);
      setRenamingSelectAllOnOpen(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create folder");
    }
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
    setRenamingSelectAllOnOpen(false);
    setRenamingFolder({ path: folderPath, name: currentName });
    setRenamingValue(currentName);
  }

  async function closeRenameFolderDialog() {
    if (renamingSelectAllOnOpen && renamingFolder) {
      try {
        await flushPendingSave();
        await deleteFolder(renamingFolder.path);
        await refreshSnapshot();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to discard new folder");
        return;
      }
    }
    setRenamingFolder(null);
    setRenamingSelectAllOnOpen(false);
  }

  async function confirmRenameFolder() {
    if (!renamingFolder) return;
    const nextName = renamingValue.trim();
    if (!nextName || nextName === renamingFolder.name) {
      setRenamingFolder(null);
      setRenamingSelectAllOnOpen(false);
      return;
    }

    try {
      await flushPendingSave();
      await renameFolder(renamingFolder.path, nextName);
      await refreshSnapshot();
      setRenamingFolder(null);
      setRenamingSelectAllOnOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename folder");
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
    ]);

    if (selected === "new-note") {
      void handleCreateNote();
    } else if (selected === "new-folder") {
      void handleCreateFolder();
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
      if (!current) {
        return current;
      }

      if (field === "markdown") {
        return {
          ...current,
          markdown: value,
          title: titleFromMarkdown(value, current.title),
        };
      }

      return { ...current, [field]: value };
    });
  }

  function startResize() {
    resizingRef.current = true;
    document.body.classList.add("is-resizing");
  }

  function toggleSidebar() {
    setSidebarCollapsed((value) => !value);
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
        handleCreateNote();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNote, getShortcut]);

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

    return result;
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

  const notes = snapshot.notes;
  const notePath = selectedNote?.path ?? "notes/untitled-note.md";
  const tree = buildNoteTree(notes, snapshot.folders);
  const pinnedNotes = snapshot.notes.filter((n) => n.pinned);
  const notesLoading = appLoading || workspaceLoading;
  const syncStatus = !snapshot.backend.backendReachable
    ? { icon: WifiOff, label: "Offline" as const }
    : snapshot.backend.authStatus === "authenticating"
      ? { icon: Loader2, label: "Checking auth" as const, iconClassName: "[&_svg]:animate-spin" as const }
      : snapshot.backend.authStatus !== "authenticated"
        ? { icon: LogIn, label: "Sign in required" as const }
        : saveState === "saving" || backendSyncing
          ? { icon: RefreshCw, label: "Syncing..." as const, iconClassName: "[&_svg]:animate-spin" as const }
          : saveState === "error"
            ? { icon: AlertCircle, label: "Sync failed" as const, iconClassName: "text-red-400" as const }
            : snapshot.backend.authStatus === "authenticated"
              ? { icon: Cloud, label: "Synced to cloud" as const }
              : { icon: HardDrive, label: "Saved locally" as const };
  const isFloatingSidebar = viewportWidth <= XS_SIDEBAR_BREAKPOINT;
  const desktopShellColumns = !sidebarCollapsed && !isFloatingSidebar ? `${sidebarWidth}px 10px minmax(0, 1fr)` : "0px 0px minmax(0, 1fr)";
  const floatingSidebarWidth = Math.min(sidebarWidth, Math.max(MIN_SIDEBAR_WIDTH, viewportWidth - 24));
  const showWindowControlsInMainHeader = sidebarCollapsed || isFloatingSidebar;
  const sidebarToggleLabel = sidebarCollapsed ? "Open left panel" : "Close left panel";

  function renderMainHeaderControls(includeNavigation: boolean) {
    return (
      <div className="mr-2.5 flex items-center gap-3 [-webkit-app-region:no-drag]">
        <WindowControls visible={showWindowControlsInMainHeader} />
        <div className={cn("flex", includeNavigation ? "mr-2 gap-0" : "gap-0.5")}>
          <button
            type="button"
            className={cn(
              "flex size-6 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-muted hover:bg-white/[0.08] hover:text-foreground",
              includeNavigation && "mr-3",
            )}
            onClick={toggleSidebar}
            title={sidebarToggleLabel}
            aria-label={sidebarToggleLabel}
            aria-pressed={!sidebarCollapsed}
          >
            <PanelLeft size={14} />
          </button>
          {includeNavigation ? (
            <>
              <button
                type="button"
                className="flex size-6 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-muted hover:bg-white/[0.08] hover:text-foreground disabled:cursor-default disabled:opacity-30"
                disabled={!canGoBack}
                onClick={handleNavBack}
                title="Go back"
              >
                <ArrowLeft size={14} />
              </button>
              <button
                type="button"
                className="flex size-6 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-muted hover:bg-white/[0.08] hover:text-foreground disabled:cursor-default disabled:opacity-30"
                disabled={!canGoForward}
                onClick={handleNavForward}
                title="Go forward"
              >
                <ArrowRight size={14} />
              </button>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  function renderSidebarPanel(floating: boolean) {
    return (
      <aside
        className={cn(
          "sidebar-shell",
          floating
            ? [
                "sidebar-shell--floating absolute left-2 right-auto bottom-2 z-40 overflow-hidden rounded-[4px] border border-white/[0.06] shadow-[0_24px_72px_rgba(0,0,0,0.44)]",
                "transition-[transform,opacity,box-shadow] duration-220 ease-out motion-reduce:transition-none",
              ]
            : "sidebar-shell--docked",
          sidebarCollapsed && "pointer-events-none overflow-hidden",
          sidebarTransitionDisabled && "transition-none!",
        )}
        data-sidebar-mode={sidebarMode}
        data-sidebar-presentation={floating ? "floating" : "docked"}
        aria-hidden={sidebarCollapsed}
        style={
          floating
            ? ({
                width: floatingSidebarWidth,
                top: 8,
                transform: sidebarCollapsed ? "translateX(calc(-100% - 16px))" : "translateX(0)",
                opacity: sidebarCollapsed ? 0 : 1,
              } as React.CSSProperties)
            : undefined
        }
      >
        <div
          className={cn(
            "flex min-h-[48px] items-center justify-between py-0 pl-3 pr-0.5 [-webkit-app-region:drag]",
            floating && "justify-start",
          )}
          data-electron-drag-region="true"
        >
          <WindowControls visible={!floating} />

          <div
            className={cn(
              "flex flex-row items-center align-center justify-end gap-1 text-[0.88rem] text-muted",
              floating && "justify-between w-full",
            )}
          >
            <div className="text-[0.82rem] font-normal uppercase tracking-[0.12em] text-faint">slate</div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" onClick={() => setSettingsOpen(true)} aria-label="Settings">
                  <Settings size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Settings</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden pl-3.5 pr-1 pb-1"
          onContextMenu={(event) => void handleSidebarContextMenu(event)}
        >
          {sidebarMode === "notes" ? (
            <div className="mb-1.5 flex w-full max-w-full min-w-0 shrink-0 items-center justify-between text-[0.88rem] text-muted tracking-wide">
              <span className="text-[0.9rem] font-normal tracking-wide text-foreground" style={{ userSelect: "none" }}>
                Notes
              </span>
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
                      onClick={() => setSidebarMode("chat")}
                      aria-label="Open AI chat"
                    >
                      <Sparkles size={14} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Open AI chat</TooltipContent>
                </Tooltip>
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
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ) : null}

          {sidebarMode === "chat" ? (
            <ChatSidebar
              ref={chatSidebarRef}
              backendAuthenticated={snapshot.backend.authStatus === "authenticated"}
              notes={notes}
              onBackToNotes={() => setSidebarMode("notes")}
              onNoteClick={(docId) => {
                setSidebarMode("notes");
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
                  <div className="flex w-full justify-center px-4 py-3 text-[0.82rem] text-faint">No notes yet</div>
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
                        onCreateNote={handleCreateNote}
                        onCreateFolder={handleCreateFolder}
                        onRenameFolder={handleRenameFolder}
                        onDeleteFolder={handleDeleteFolder}
                        onMoveNote={handleMoveNote}
                        onMoveFolder={handleMoveFolder}
                        collapsedPaths={collapsedPaths}
                        onTogglePath={togglePath}
                        onTogglePin={handleTogglePin}
                        onRescan={(noteId) => {
                          void rescanNote(noteId).then(() => refreshSnapshot());
                        }}
                      />
                    ))}
                  </DndContext>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      </aside>
    );
  }

  return (
    <div
      className={cn("desktop-shell relative box-border grid h-screen overflow-hidden border border-white/[0.04]")}
      style={{ "--desktop-shell-columns": desktopShellColumns } as React.CSSProperties}
    >
      {isFloatingSidebar && !sidebarCollapsed ? (
        <div
          className="pointer-events-auto absolute inset-0 z-30 bg-black/[0.18] opacity-100 transition-opacity duration-200 ease-out motion-reduce:transition-none"
          onClick={() => setSidebarCollapsed(true)}
          aria-hidden="true"
        />
      ) : null}
      {!isFloatingSidebar ? renderSidebarPanel(false) : null}
      {isFloatingSidebar ? renderSidebarPanel(true) : null}

      {sidebarCollapsed || isFloatingSidebar ? <div aria-hidden="true" /> : (
        <div
          className="sidebar-resizer"
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
        >
          <GripVertical size={14} />
        </div>
      )}

      <main
        className="relative z-0 flex h-screen min-h-0 min-w-0 flex-col bg-panel"
        style={isFloatingSidebar ? ({ gridColumn: "1 / -1" } as React.CSSProperties) : undefined}
      >
        {selectedNote ? (
          <div
            className="flex min-h-[48px] items-center border-b border-border-soft px-6 [-webkit-app-region:drag]"
            data-electron-drag-region="true"
          >
            {renderMainHeaderControls(true)}
            <div className="flex min-w-0 gap-3.5 overflow-hidden text-[0.88rem] text-muted [&>span]:shrink-0 [&>span]:truncate [&>span]:overflow-hidden [&>span]:whitespace-nowrap [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:shrink">
              <span
                className={cn(
                  "flex shrink-0 cursor-default items-center text-muted [-webkit-app-region:no-drag]",
                  "iconClassName" in syncStatus ? syncStatus.iconClassName : undefined,
                )}
                title={syncStatus.label}
              >
                <syncStatus.icon size={14} />
              </span>
              <span style={{ userSelect: "none" }}>{notePath}</span>
            </div>
          </div>
        ) : (
          <div
            className="flex min-h-[38px] items-center border-b-0 px-6 [-webkit-app-region:drag]"
            data-electron-drag-region="true"
          >
            {renderMainHeaderControls(false)}
          </div>
        )}
        <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", isFloatingSidebar && "overflow-hidden")}>
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
          <ScrollArea className="min-h-0 flex-1 overflow-hidden">
            {selectedNote ? (
              <div className="editor-document min-h-full px-11 pb-10 pt-[18px] max-md:px-6">
                <div className="relative">
                  <YDocProvider noteId={selectedNoteId}>
                    <EditorWithYDoc
                      selectedNote={selectedNote}
                      editorHandleRef={editorHandleRef}
                      onChange={(markdown) => updateSelectedNote("markdown", markdown)}
                      onUploadFile={handleUploadFile}
                      onRejectFile={(file) => toast.error(`Only images are supported`, { description: `"${file.name}" can't be added to a note.` })}
                      resolveImageUrl={resolveAttachmentUrl}
                      notes={snapshot.notes}
                      currentNoteId={selectedNote.id}
                      onNavigateNote={(noteId) => void handleSelectNote(noteId)}
                      onTableContextMenu={async () => {
                        const action = await showContextMenu([
                          { id: "add-row-before", label: "Insert Row Above" },
                          { id: "add-row-after", label: "Insert Row Below" },
                          { type: "separator", id: "sep1", label: "" },
                          { id: "add-col-before", label: "Insert Column Left" },
                          { id: "add-col-after", label: "Insert Column Right" },
                          { type: "separator", id: "sep2", label: "" },
                          { id: "delete-row", label: "Delete Row" },
                          { id: "delete-col", label: "Delete Column" },
                        ]);
                        return action as any;
                      }}
                    />
                  </YDocProvider>
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
        </div>
      </main>

      <CommandBar
        open={commandBarOpen}
        notes={snapshot.notes}
        onSelect={(noteId) => {
          setCommandBarOpen(false);
          void handleSelectNote(noteId);
        }}
        onClose={() => setCommandBarOpen(false)}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          if (workspaceLoading) return;
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
        workspaceLoading={workspaceLoading}
        workspaceStatus={workspaceStatus}
        connectionStatus={connectionStatus}
        connectionError={connectionError}
        authEmail={authEmail}
        authPassword={authPassword}
        onAuthEmailChange={setAuthEmail}
        onAuthPasswordChange={setAuthPassword}
        authSubmitting={authSubmitting}
        authError={authError}
        onChooseWorkspace={handleChooseWorkspace}
        onTestConnection={handleTestConnection}
        onSaveEndpoint={handleSaveEndpoint}
        onLogin={handleLogin}
        onLoginWithOidc={handleOidcLogin}
        onCancelOidc={() => void cancelOidc()}
        onSignOut={handleSignOut}
        onFullSync={handleFullSync}
        fullSyncing={backendSyncing}
      />

      <RenameFolderDialog
        open={renamingFolder !== null}
        onOpenChange={(open) => {
          if (!open) void closeRenameFolderDialog();
        }}
        folder={renamingFolder}
        value={renamingValue}
        onValueChange={setRenamingValue}
        onConfirm={confirmRenameFolder}
        selectAllOnOpen={renamingSelectAllOnOpen}
      />

      <DeleteFolderDialog
        open={deletingFolder !== null}
        onOpenChange={(open) => { if (!open) setDeletingFolder(null); }}
        folderPath={deletingFolder}
        onConfirm={confirmDeleteFolder}
      />

      <DeleteNoteDialog
        open={deletingNote !== null}
        onOpenChange={(open) => { if (!open) setDeletingNote(null); }}
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
    </div>
  );
}
