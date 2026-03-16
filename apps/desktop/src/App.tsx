import { useEffect, useRef, useState } from "react";
import type { DesktopSnapshot, LocalNoteSummary } from "@slate/shared/index";
import { ChevronRight, FilePlus2, FileText, FolderOpen, FolderPlus, GripVertical, Keyboard, NotebookPen, Plus, Settings } from "lucide-react";
import { MilkdownEditor, type MilkdownEditorHandle } from "./components/MilkdownEditor";
import { Button } from "./components/ui/button";
import type { ContextMenuItem as NativeMenuItem } from "./lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/ui/dropdown-menu";
import { ScrollArea } from "./components/ui/scroll-area";
import { Separator } from "./components/ui/separator";
import { checkBackendConnection, chooseWorkspaceDirectory, createFolder, createNote, deleteFolder, deleteNote, getSnapshot, loadNote, renameFolder, saveNote, setBackendEndpoint, showContextMenu } from "./lib/api";

const DEFAULT_SIDEBAR_WIDTH = 320;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 480;

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
      connected: false,
    },
    notes: [],
    folders: [],
  };
}

function formatRelativeTime(updatedAt: string) {
  const then = new Date(updatedAt).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const hours = Math.max(1, Math.round(diff / (1000 * 60 * 60)));
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.round(days / 7)}w`;
}

type SaveState = "idle" | "saving" | "saved" | "error";
type NoteTreeNode = {
  name: string;
  path: string;
  folders: NoteTreeNode[];
  notes: LocalNoteSummary[];
};

type MutableTreeNode = {
  name: string;
  path: string;
  folders: MutableTreeNode[];
  notes: LocalNoteSummary[];
  folderMap: Map<string, MutableTreeNode>;
};

function basename(notePath: string) {
  const name = notePath.split("/").pop() ?? notePath;
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

function buildNoteTree(notes: LocalNoteSummary[], folderPaths: string[] = []): NoteTreeNode[] {
  const root: MutableTreeNode = {
    name: "",
    path: "",
    folders: [],
    notes: [],
    folderMap: new Map(),
  };

  function ensureFolder(folderPath: string): MutableTreeNode {
    const segments = folderPath.split("/").filter(Boolean);
    let current = root;
    let currentPath = "";

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let node = current.folderMap.get(segment);
      if (!node) {
        node = { name: segment, path: currentPath, folders: [], notes: [], folderMap: new Map() };
        current.folderMap.set(segment, node);
        current.folders.push(node);
      }
      current = node;
    }

    return current;
  }

  // Seed empty folders so they appear even without notes
  for (const folderPath of folderPaths) {
    ensureFolder(folderPath);
  }

  for (const note of notes) {
    const segments = note.path.split("/").filter(Boolean);
    const folders = segments.slice(0, -1);
    const parent = folders.length > 0 ? ensureFolder(folders.join("/")) : root;
    parent.notes.push(note);
  }

  function finalize(node: MutableTreeNode): NoteTreeNode {
    return {
      name: node.name,
      path: node.path,
      folders: node.folders
        .map(finalize)
        .sort((a, b) => a.name.localeCompare(b.name)),
      notes: node.notes
        .slice()
        .sort((a, b) => basename(a.path).localeCompare(basename(b.path))),
    };
  }

  const finalizedRoot = finalize(root);
  return finalizedRoot.folders.length || finalizedRoot.notes.length ? [finalizedRoot] : [];
}

function TreeBranch({
  node,
  depth,
  selectedNoteId,
  onSelectNote,
  onDeleteNote,
  onCreateNote,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  collapsedPaths,
  onTogglePath,
}: {
  node: NoteTreeNode;
  depth: number;
  selectedNoteId: string;
  onSelectNote: (noteId: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onCreateNote: (parentPath?: string) => Promise<void>;
  onCreateFolder: (parentPath?: string) => Promise<void>;
  onRenameFolder: (folderPath: string, currentName: string) => void;
  onDeleteFolder: (folderPath: string) => void;
  collapsedPaths: Set<string>;
  onTogglePath: (path: string) => void;
}) {
  const isRoot = !node.name;
  const isCollapsed = node.path ? collapsedPaths.has(node.path) : false;

  async function handleFolderContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const items: NativeMenuItem[] = [
      { id: "new-note", label: "New Note" },
      { id: "new-folder", label: "New Folder" },
      { type: "separator" },
      { id: "rename", label: "Rename Folder" },
      { type: "separator" },
      { id: "delete", label: "Delete Folder" },
    ];
    const selected = await showContextMenu(items);
    if (selected === "new-note") void onCreateNote(node.path);
    else if (selected === "new-folder") void onCreateFolder(node.path);
    else if (selected === "rename") onRenameFolder(node.path, node.name);
    else if (selected === "delete") onDeleteFolder(node.path);
  }

  async function handleNoteContextMenu(e: React.MouseEvent, noteId: string) {
    e.preventDefault();
    const items: NativeMenuItem[] = [
      { id: "delete", label: "Delete Note" },
    ];
    const selected = await showContextMenu(items);
    if (selected === "delete") void onDeleteNote(noteId);
  }

  return (
    <div className="tree-branch">
      {node.name ? (
        <button
          className="tree-folder"
          style={{ paddingLeft: `${depth * 14}px` }}
          onClick={() => onTogglePath(node.path)}
          onContextMenu={handleFolderContextMenu}
        >
          <ChevronRight size={14} className={`tree-folder__chevron ${isCollapsed ? "" : "is-open"}`} />
          <FolderOpen size={14} />
          <span>{node.name}</span>
        </button>
      ) : null}

      {!isCollapsed && node.notes.map((note) => (
        <button
          key={note.id}
          className={`note-row ${note.id === selectedNoteId ? "is-active" : ""}`}
          onClick={() => void onSelectNote(note.id)}
          onContextMenu={(e) => void handleNoteContextMenu(e, note.id)}
          style={{ paddingLeft: `${depth * 14 + (isRoot ? 8 : 22)}px` }}
        >
          <div className="note-row__icon">
            <FileText size={14} />
          </div>
          <div className="note-row__copy">
            <div className="note-row__title">{basename(note.path)}</div>
          </div>
        </button>
      ))}

      {!isCollapsed && node.folders.map((child) => (
        <TreeBranch
          key={child.path}
          node={child}
          depth={depth + (isRoot ? 0 : 1)}
          selectedNoteId={selectedNoteId}
          onSelectNote={onSelectNote}
          onDeleteNote={onDeleteNote}
          onCreateNote={onCreateNote}
          onCreateFolder={onCreateFolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          collapsedPaths={collapsedPaths}
          onTogglePath={onTogglePath}
        />
      ))}
    </div>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<DesktopSnapshot>(initialSnapshot);
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
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [connectionError, setConnectionError] = useState("");
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = window.localStorage.getItem("slate.desktop.sidebar-width");
    const width = stored ? Number(stored) : DEFAULT_SIDEBAR_WIDTH;
    return Number.isFinite(width) ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)) : DEFAULT_SIDEBAR_WIDTH;
  });

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

  useEffect(() => {
    void refreshSnapshot();
  }, []);

  useEffect(() => {
    window.localStorage.setItem("slate.desktop.sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);

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

  async function refreshSnapshot() {
    try {
      const nextSnapshot = await getSnapshot();
      setSnapshot(nextSnapshot);

      if (selectedNoteId && !nextSnapshot.notes.some((note) => note.id === selectedNoteId)) {
        setSelectedNoteId("");
        setSelectedNote(null);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load workspace");
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
    try {
      await setBackendEndpoint(endpoint);
      await refreshSnapshot();
      setConnectionStatus("idle");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save endpoint");
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
    setSelectedNote((current) => (current ? { ...current, [field]: value } : current));
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

  // --- Search in note ---

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && selectedNote) {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNote]);

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

        <div className="sidebar-content">
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
              <span>{snapshot.backend.connected ? "Connected" : "Offline"}</span>
              <span>{saveState === "saving" ? "Saving..." : saveState === "error" ? "Save failed" : "Saved locally"}</span>
              <span>{notePath}</span>
            </div>
          </div>
        ) : (
          <div className="editor-titlebar editor-titlebar--empty" data-electron-drag-region="true" />
        )}
        {searchOpen && (
          <div className={`search-bar${searchClosing ? " is-closing" : ""}`}>
            <input
              ref={searchInputRef}
              className="search-bar__input"
              type="text"
              placeholder="Find in note…"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeSearch();
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  navigateSearch(e.shiftKey ? -1 : 1);
                }
              }}
            />
            {searchQuery && (
              <span className="search-bar__count">
                {searchCount > 0 ? `${searchIndex + 1} of ${searchCount}` : "No results"}
              </span>
            )}
            <button type="button" className="search-bar__nav" onClick={() => navigateSearch(-1)} disabled={searchCount === 0} aria-label="Previous match">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <button type="button" className="search-bar__nav" onClick={() => navigateSearch(1)} disabled={searchCount === 0} aria-label="Next match">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <button type="button" className="search-bar__close" onClick={closeSearch} aria-label="Close search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        )}
        <ScrollArea className="editor-scroll">
          {selectedNote ? (
            <div className="editor-document">
              <div className="editor-surface-shell">
                <MilkdownEditor
                  ref={editorHandleRef}
                  key={selectedNote.id}
                  value={selectedNote.markdown}
                  onChange={(markdown) => updateSelectedNote("markdown", markdown)}
                />
              </div>

              {errorMessage ? <div className="status-banner">{errorMessage}</div> : null}
            </div>
          ) : snapshot.notes.length === 0 ? (
            <div className="welcome">
              <div className="welcome__icon">
                <NotebookPen size={40} strokeWidth={1.5} />
              </div>
              <h1 className="welcome__title">Welcome to Slate</h1>
              <p className="welcome__subtitle">A calm place for your thoughts, notes, and ideas.</p>
              <div className="welcome__actions">
                <Button variant="primary" onClick={() => handleCreateNote()}>
                  <FilePlus2 size={16} />
                  Create your first note
                </Button>
              </div>
              <div className="welcome__hints">
                <div className="welcome__hint">
                  <Keyboard size={14} />
                  <span>Type <kbd>/</kbd> for formatting commands</span>
                </div>
                <div className="welcome__hint">
                  <FolderOpen size={14} />
                  <span>Organize notes into folders from the sidebar</span>
                </div>
                <div className="welcome__hint">
                  <Settings size={14} />
                  <span>Change your workspace folder in Settings</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state__title">No note selected</div>
              <div className="empty-state__copy">Choose a note from the sidebar, or create a new one.</div>
            </div>
          )}
        </ScrollArea>
      </main>

      <Dialog open={settingsOpen} onOpenChange={(open) => {
        if (workspaceLoading) {
          return;
        }
        if (open) {
          setBackendEndpointValue(snapshot.backend.endpoint);
          setConnectionStatus("idle");
          setConnectionError("");
        }
        setSettingsOpen(open);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Manage your workspace and sync settings.
            </DialogDescription>
          </DialogHeader>

          <div className="settings-panel">
            <div className="settings-section__title">Workspace</div>
            <div className="settings-field">
              <div className="settings-field__label">Root folder</div>
              <div className="settings-field__value">{snapshot.workspace.rootPath}</div>
            </div>

            <Button variant="secondary" onClick={() => void handleChooseWorkspace()} disabled={workspaceLoading}>
              {workspaceLoading ? "Loading..." : "Choose root folder"}
            </Button>

            {workspaceStatus ? (
              <div className="settings-status">
                <div className="settings-status__label">{workspaceStatus}</div>
                <div className="settings-status__bar">
                  <div className={`settings-status__fill ${workspaceLoading ? "is-loading" : "is-complete"}`} />
                </div>
              </div>
            ) : null}

            <Separator />

            <div className="settings-section__title">Sync</div>
            <div className="settings-field">
              <div className="settings-field__label">Server URL</div>
              <input
                className="ui-input ui-input--bordered"
                value={backendEndpoint}
                onChange={(e) => {
                  setBackendEndpointValue(e.target.value);
                  setConnectionStatus("idle");
                  setConnectionError("");
                }}
                placeholder="your-server.example.com:50051"
              />
            </div>

            <div className="settings-field__row">
              <Button variant="secondary" onClick={() => void handleTestConnection()} disabled={connectionStatus === "testing"}>
                {connectionStatus === "testing" ? "Testing..." : "Test connection"}
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleSaveEndpoint()}
                disabled={!backendEndpoint.trim() || backendEndpoint.trim() === snapshot.backend.endpoint}
              >
                Save
              </Button>
            </div>

            {connectionStatus === "success" ? (
              <div className="settings-connection settings-connection--success">Connected successfully</div>
            ) : null}

            {connectionStatus === "error" ? (
              <div className="settings-connection settings-connection--error">Could not reach server</div>
            ) : null}

            <div className="settings-field">
              <div className="settings-field__label">Status</div>
              <div className="settings-field__value">{snapshot.backend.connected ? "Connected" : "Not connected"}</div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={renamingFolder !== null} onOpenChange={(open) => { if (!open) setRenamingFolder(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
            <DialogDescription>Enter a new name for this folder.</DialogDescription>
          </DialogHeader>
          <form className="settings-panel" onSubmit={(e) => { e.preventDefault(); void confirmRenameFolder(); }}>
            <input
              className="ui-input ui-input--bordered"
              value={renamingValue}
              onChange={(e) => setRenamingValue(e.target.value)}
              autoFocus
            />
            <div className="dialog-actions">
              <Button variant="secondary" onClick={() => setRenamingFolder(null)}>Cancel</Button>
              <Button variant="primary" type="submit">Rename</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deletingFolder !== null} onOpenChange={(open) => { if (!open) setDeletingFolder(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete folder</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deletingFolder}</strong> and all notes inside it? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setDeletingFolder(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void confirmDeleteFolder()}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
