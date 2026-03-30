import { useEffect, useRef, useState } from "react";
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
    return <div className="editor-loading"></div>;
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
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = window.localStorage.getItem("slate.desktop.sidebar-width");
    const width = stored ? Number(stored) : DEFAULT_SIDEBAR_WIDTH;
    return Number.isFinite(width) ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)) : DEFAULT_SIDEBAR_WIDTH;
  });

  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<'notes' | 'chat'>('notes');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchClosing, setSearchClosing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchCount, setSearchCount] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const editorHandleRef = useRef<MilkdownEditorHandle | null>(null);
  const chatSidebarRef = useRef<ChatSidebarHandle | null>(null);
  const lastPolledBackendFingerprintRef = useRef<string | null>(null);

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
    window.localStorage.setItem("slate.desktop.sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);

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
      const cmdBarShortcut = getShortcut("command-bar");
      const findShortcut = getShortcut("find-in-note");

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
    ? { icon: WifiOff, label: "Offline", className: "sync-icon--warn" }
    : snapshot.backend.authStatus === "authenticating"
      ? { icon: Loader2, label: "Checking auth", className: "sync-icon--spin" }
      : snapshot.backend.authStatus !== "authenticated"
        ? { icon: LogIn, label: "Sign in required", className: "sync-icon--warn" }
        : saveState === "saving" || backendSyncing
          ? { icon: RefreshCw, label: "Syncing...", className: "sync-icon--spin" }
          : saveState === "error"
            ? { icon: AlertCircle, label: "Sync failed", className: "sync-icon--error" }
            : snapshot.backend.authStatus === "authenticated"
              ? { icon: Cloud, label: "Synced to cloud", className: "" }
              : { icon: HardDrive, label: "Saved locally", className: "" };

  return (
    <div className="desktop-shell" style={{ gridTemplateColumns: `${sidebarWidth}px 10px minmax(0, 1fr)` }}>
      <aside className="sidebar-shell" data-sidebar-mode={sidebarMode}>
        <div className="window-strip" data-electron-drag-region="true">
          <div className="traffic-lights" aria-hidden="true">
            <span className="traffic red" />
            <span className="traffic yellow" />
            <span className="traffic green" />
          </div>
          <div className="window-strip__actions">
            <div className="window-strip__label">slate</div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button className="ui-button--icon" variant="ghost" onClick={() => setSettingsOpen(true)} aria-label="Settings">
                  <Settings size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Settings</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="sidebar-content" onContextMenu={(event) => void handleSidebarContextMenu(event)}>
        {sidebarMode === "notes" ? (
            <div className="sidebar-heading">
              <span className="sidebar-heading__title" style={{ userSelect: "none" }}>Notes</span>
              <div className="sidebar-heading__actions">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="sidebar-heading__button"
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
                        <button type="button" className="sidebar-heading__button" aria-label="Create new note or folder">
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

          {sidebarMode === 'chat' ? (
            <ChatSidebar
              ref={chatSidebarRef}
              backendAuthenticated={snapshot.backend.authStatus === "authenticated"}
              notes={notes}
              onBackToNotes={() => setSidebarMode('notes')}
              onNoteClick={(docId) => {
                setSidebarMode('notes');
                void handleSelectNote(docId);
              }}
              onOpenNoteInEditor={(docId) => {
                void handleSelectNote(docId);
              }}
            />
          ) : (
            <ScrollArea className="sidebar-scroll">
              <div className="notes-tree">
                <PinnedSection
                  notes={pinnedNotes}
                  selectedNoteId={selectedNoteId}
                  onSelectNote={handleSelectNote}
                  onDeleteNote={handleDeleteNote}
                  onTogglePin={handleTogglePin}
                />
                {tree.length === 0 ? (
                  <div className="sidebar-empty">No notes yet</div>
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
                        onRescan={(noteId) => { void rescanNote(noteId).then(() => refreshSnapshot()); }}
                      />
                    ))}
                  </DndContext>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      </aside>

      <div
        className="sidebar-resizer"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      >
        <GripVertical size={14} />
      </div>

      <main className="editor-shell">
        {selectedNote ? (
          <div className="editor-titlebar" data-electron-drag-region="true">
            <div className="editor-titlebar__nav">
              <button className="editor-titlebar__nav-btn" disabled={!canGoBack} onClick={handleNavBack} title="Go back">
                <ArrowLeft size={14} />
              </button>
              <button className="editor-titlebar__nav-btn" disabled={!canGoForward} onClick={handleNavForward} title="Go forward">
                <ArrowRight size={14} />
              </button>
            </div>
            <div className="editor-titlebar__meta">
              <span className={`sync-icon ${syncStatus.className}`} title={syncStatus.label}>
                <syncStatus.icon size={14} />
              </span>
              <span style={{ userSelect: "none" }}>{notePath}</span>
            </div>
          </div>
        ) : (
          <div className="editor-titlebar editor-titlebar--empty" data-electron-drag-region="true" />
        )}
        <div className="editor-content-region">
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
        <ScrollArea className="editor-scroll">
          {selectedNote ? (
            <div className="editor-document">
              <div className="editor-surface-shell">
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

              {errorMessage ? <div className="status-banner">{errorMessage}</div> : null}
            </div>
          ) : notesLoading ? (
            <div className="editor-document" />
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
