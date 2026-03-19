import { useEffect, useRef, useState } from "react";
import type { DesktopSnapshot, LocalNoteSummary } from "@slate/shared/index";
import { FilePlus2, FolderPlus, GripVertical, Plus, Settings } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Button } from "./components/ui/button";
import { DeleteFolderDialog } from "./components/DeleteFolderDialog";
import { EmptyState } from "./components/EmptyState";
import { MilkdownEditor, type MilkdownEditorHandle } from "./components/MilkdownEditor";
import { TreeBranch } from "./components/NoteTree";
import { RenameFolderDialog } from "./components/RenameFolderDialog";
import { CommandBar } from "./components/CommandBar";
import { SearchBar } from "./components/SearchBar";
import { SettingsDialog, type ConnectionStatus } from "./components/SettingsDialog";
import { Welcome } from "./components/Welcome";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/ui/dropdown-menu";
import { ScrollArea } from "./components/ui/scroll-area";
import { buildNoteTree } from "./lib/noteTree";
import { useKeyboardShortcuts, matchesShortcut } from "./lib/shortcuts";
import {
  cancelOidc,
  checkBackendConnection,
  chooseWorkspaceDirectory,
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  getLastOpenNoteId,
  getSnapshot,
  loginWithOidc,
  loginWithPassword,
  loadNote,
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

type SaveState = "idle" | "saving" | "saved" | "error";
export function App() {
  const [snapshot, setSnapshot] = useState<DesktopSnapshot>(initialSnapshot);
  const [appLoading, setAppLoading] = useState(true);
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [selectedNote, setSelectedNote] = useState<LocalNoteSummary | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<{ path: string; name: string } | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchClosing, setSearchClosing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchCount, setSearchCount] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const editorHandleRef = useRef<MilkdownEditorHandle | null>(null);

  const loadRequestIdRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedRef = useRef("");
  const selectedNoteRef = useRef<LocalNoteSummary | null>(null);
  const resizingRef = useRef(false);

  selectedNoteRef.current = selectedNote;

  const { getShortcut } = useKeyboardShortcuts();

  useEffect(() => {
    void initializeApp();
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

    const handleWindowFocus = () => {
      void updateBackendStatus();
    };

    window.addEventListener("focus", handleWindowFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, []);

  async function initializeApp() {
    try {
      const [nextSnapshot, lastNoteId] = await Promise.all([
        getSnapshot(),
        getLastOpenNoteId(),
      ]);
      setSnapshot(nextSnapshot);
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

  async function handleSelectNote(noteId: string) {
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
      await refreshSnapshot();
      await handleSelectNote(note.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create note");
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
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create folder");
    }
  }

  async function handleDeleteNote(noteId: string) {
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

  function handleRenameFolder(folderPath: string, currentName: string) {
    setRenamingFolder({ path: folderPath, name: currentName });
    setRenamingValue(currentName);
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
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to rename folder");
    }
    setRenamingFolder(null);
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
      workspaceId: snapshot.backend.authenticatedWorkspaceId ?? snapshot.workspace.id ?? "local",
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
  const notesLoading = appLoading || workspaceLoading;
  const syncStatusLabel = !snapshot.backend.backendReachable
    ? "Offline"
    : snapshot.backend.authStatus === "authenticating"
        ? "Checking auth"
        : snapshot.backend.authStatus === "authenticated"
          ? null
          : "Sign in required";
  const saveStatusLabel = saveState === "saving"
    ? "Syncing..."
    : saveState === "error"
      ? "Sync failed"
      : snapshot.backend.authStatus === "authenticated"
        ? "Synced to cloud"
        : "Saved locally";

  return (
    <div className="desktop-shell" style={{ gridTemplateColumns: `${sidebarWidth}px 10px minmax(0, 1fr)` }}>
      <aside className="sidebar-shell">
        <div className="window-strip" data-electron-drag-region="true">
          <div className="traffic-lights" aria-hidden="true">
            <span className="traffic red" />
            <span className="traffic yellow" />
            <span className="traffic green" />
          </div>
          <div className="window-strip__actions">
            <div className="window-strip__label">slate</div>
            <Button className="ui-button--icon" variant="ghost" onClick={() => setSettingsOpen(true)}>
              <Settings size={16} />
            </Button>
          </div>
        </div>

        <div className="sidebar-content" onContextMenu={(event) => void handleSidebarContextMenu(event)}>
          <div className="sidebar-heading">
            <span>Notes</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="sidebar-heading__button">
                  <Plus size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void handleCreateNote()}>
                  <FilePlus2 size={14} /> New note
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleCreateFolder()}>
                  <FolderPlus size={14} /> New folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <ScrollArea className="sidebar-scroll">
            <div className="notes-tree">
              {tree.length === 0 ? (
                <div className="sidebar-empty">No notes yet</div>
              ) : (
                tree.map((node) => (
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
                    collapsedPaths={collapsedPaths}
                    onTogglePath={togglePath}
                  />
                ))
              )}
            </div>
          </ScrollArea>
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
            <div className="editor-titlebar__meta">
              {syncStatusLabel ? <span>{syncStatusLabel}</span> : null}
              <span>{saveStatusLabel}</span>
              <span>{notePath}</span>
            </div>
          </div>
        ) : (
          <div className="editor-titlebar editor-titlebar--empty" data-electron-drag-region="true" />
        )}
        <SearchBar
          open={searchOpen}
          closing={searchClosing}
          query={searchQuery}
          index={searchIndex}
          count={searchCount}
          onQueryChange={handleSearchChange}
          onNavigate={navigateSearch}
          onClose={closeSearch}
          inputRef={searchInputRef}
        />
        <ScrollArea className="editor-scroll">
          {selectedNote ? (
            <div className="editor-document">
              <div className="editor-surface-shell">
                <MilkdownEditor
                  ref={editorHandleRef}
                  key={selectedNote.id}
                  value={selectedNote.markdown}
                  onChange={(markdown) => updateSelectedNote("markdown", markdown)}
                  onUploadFile={handleUploadFile}
                  onRejectFile={(file) => toast.error(`Only images are supported`, { description: `"${file.name}" can't be added to a note.` })}
                  resolveImageUrl={resolveAttachmentUrl}
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
      />

      <RenameFolderDialog
        open={renamingFolder !== null}
        onOpenChange={(open) => { if (!open) setRenamingFolder(null); }}
        folder={renamingFolder}
        value={renamingValue}
        onValueChange={setRenamingValue}
        onConfirm={confirmRenameFolder}
      />

      <DeleteFolderDialog
        open={deletingFolder !== null}
        onOpenChange={(open) => { if (!open) setDeletingFolder(null); }}
        folderPath={deletingFolder}
        onConfirm={confirmDeleteFolder}
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
