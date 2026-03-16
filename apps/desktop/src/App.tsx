import { useEffect, useRef, useState } from "react";
import type { DesktopSnapshot, LocalNoteSummary } from "@slate/shared/index";
import { ChevronRight, FilePenLine, FilePlus2, FileText, FolderOpen, GripVertical, Plus, Settings, Trash2 } from "lucide-react";
import { MilkdownEditor } from "./components/MilkdownEditor";
import { Button } from "./components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./components/ui/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { ScrollArea } from "./components/ui/scroll-area";
import { Separator } from "./components/ui/separator";
import { chooseWorkspaceDirectory, createNote, deleteFolder, deleteNote, getSnapshot, loadNote, renameFolder, saveNote } from "./lib/api";

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
  return notePath.split("/").pop() ?? notePath;
}

function buildNoteTree(notes: LocalNoteSummary[]): NoteTreeNode[] {
  const root: MutableTreeNode = {
    name: "",
    path: "",
    folders: [],
    notes: [],
    folderMap: new Map(),
  };

  for (const note of notes) {
    const segments = note.path.split("/").filter(Boolean);
    const folders = segments.slice(0, -1);
    let current = root;
    let currentPath = "";

    for (const folder of folders) {
      currentPath = currentPath ? `${currentPath}/${folder}` : folder;
      let node = current.folderMap.get(folder);
      if (!node) {
        node = { name: folder, path: currentPath, folders: [], notes: [], folderMap: new Map() };
        current.folderMap.set(folder, node);
        current.folders.push(node);
      }
      current = node;
    }

    current.notes.push(note);
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
  onRenameFolder: (folderPath: string, currentName: string) => Promise<void>;
  onDeleteFolder: (folderPath: string) => Promise<void>;
  collapsedPaths: Set<string>;
  onTogglePath: (path: string) => void;
}) {
  const isRoot = !node.name;
  const isCollapsed = node.path ? collapsedPaths.has(node.path) : false;

  return (
    <div className="tree-branch">
      {node.name ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              className="tree-folder"
              style={{ paddingLeft: `${depth * 14}px` }}
              onClick={() => onTogglePath(node.path)}
            >
              <ChevronRight size={14} className={`tree-folder__chevron ${isCollapsed ? "" : "is-open"}`} />
              <FolderOpen size={14} />
              <span>{node.name}</span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => void onCreateNote(node.path)}>
              <FilePlus2 size={14} />
              <span>New note</span>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void onRenameFolder(node.path, node.name)}>
              <FilePenLine size={14} />
              <span>Rename folder</span>
            </ContextMenuItem>
            <ContextMenuItem className="ui-menu__item--danger" onSelect={() => void onDeleteFolder(node.path)}>
              <Trash2 size={14} />
              <span>Delete folder</span>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : null}

      {!isCollapsed && node.notes.map((note) => (
        <ContextMenu key={note.id}>
          <ContextMenuTrigger asChild>
            <button
              className={`note-row ${note.id === selectedNoteId ? "is-active" : ""}`}
              onClick={() => void onSelectNote(note.id)}
              style={{ paddingLeft: `${depth * 14 + (isRoot ? 8 : 22)}px` }}
            >
              <div className="note-row__icon">
                <FileText size={14} />
              </div>
              <div className="note-row__copy">
                <div className="note-row__title">{basename(note.path)}</div>
              </div>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem className="ui-menu__item--danger" onSelect={() => void onDeleteNote(note.id)}>
              <Trash2 size={14} />
              <span>Delete note</span>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
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
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = window.localStorage.getItem("slate.desktop.sidebar-width");
    const width = stored ? Number(stored) : DEFAULT_SIDEBAR_WIDTH;
    return Number.isFinite(width) ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)) : DEFAULT_SIDEBAR_WIDTH;
  });

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
      setSnapshot((current) => ({
        ...current,
        notes: [note, ...current.notes.filter((entry) => entry.id !== note.id)],
      }));
      await handleSelectNote(note.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create note");
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

  async function handleRenameFolder(folderPath: string, currentName: string) {
    const nextName = window.prompt("Rename folder", currentName)?.trim();
    if (!nextName || nextName === currentName) {
      return;
    }

    try {
      await flushPendingSave();
      await renameFolder(folderPath, nextName);
      await refreshSnapshot();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to rename folder");
    }
  }

  async function handleDeleteFolder(folderPath: string) {
    const confirmed = window.confirm(`Delete folder "${folderPath}" and all notes inside it?`);
    if (!confirmed) {
      return;
    }

    try {
      await flushPendingSave();
      await deleteFolder(folderPath);
      await refreshSnapshot();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete folder");
    }
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

  const notes = snapshot.notes;
  const notePath = selectedNote?.path ?? "notes/untitled-note.md";
  const tree = buildNoteTree(notes);

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
            <button className="sidebar-heading__button" onClick={() => void handleCreateNote()}>
              <Plus size={14} />
            </button>
          </div>

          <ScrollArea className="sidebar-scroll">
            <div className="notes-tree">
              {tree.map((node) => (
                <TreeBranch
                  key={node.path || "root"}
                  node={node}
                  depth={0}
                  selectedNoteId={selectedNoteId}
                  onSelectNote={handleSelectNote}
                  onDeleteNote={handleDeleteNote}
                  onCreateNote={handleCreateNote}
                  onRenameFolder={handleRenameFolder}
                  onDeleteFolder={handleDeleteFolder}
                  collapsedPaths={collapsedPaths}
                  onTogglePath={togglePath}
                />
              ))}
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
        <div className="editor-titlebar" data-electron-drag-region="true">
          <div className="editor-titlebar__meta">
            <span>{snapshot.backend.connected ? "Connected" : "Offline"}</span>
            <span>{saveState === "saving" ? "Saving..." : saveState === "error" ? "Save failed" : "Saved locally"}</span>
            <span>{selectedNote ? notePath : snapshot.workspace.rootPath}</span>
          </div>
        </div>
        <ScrollArea className="editor-scroll">
          {selectedNote ? (
            <div className="editor-document">
              <div className="editor-surface-shell">
                <MilkdownEditor
                  key={selectedNote.id}
                  value={selectedNote.markdown}
                  onChange={(markdown) => updateSelectedNote("markdown", markdown)}
                />
              </div>

              {errorMessage ? <div className="status-banner">{errorMessage}</div> : null}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state__title">No note selected</div>
              <div className="empty-state__copy">Create a note from the left panel to start writing.</div>
            </div>
          )}
        </ScrollArea>
      </main>

      <Dialog open={settingsOpen} onOpenChange={(open) => {
        if (workspaceLoading) {
          return;
        }
        setSettingsOpen(open);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Choose the root folder for your notes. Slate will reload notes from that directory.
            </DialogDescription>
          </DialogHeader>

          <div className="settings-panel">
            <div className="settings-field">
              <div className="settings-field__label">Current root folder</div>
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
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
