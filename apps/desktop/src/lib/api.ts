import type { BackendConnectionConfig, DesktopSnapshot, LocalNoteSummary, LocalWorkspaceProfile } from "@slate/shared/index";

interface DesktopApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  chooseWorkspaceDirectory(): Promise<LocalWorkspaceProfile>;
  createNote(parentPath?: string): Promise<LocalNoteSummary>;
  loadNote(noteId: string): Promise<LocalNoteSummary>;
  saveNote(payload: { id: string; title: string; markdown: string }): Promise<LocalNoteSummary>;
  deleteNote(noteId: string): Promise<void>;
  renameFolder(folderPath: string, nextName: string): Promise<void>;
  deleteFolder(folderPath: string): Promise<void>;
  connectBackend(): Promise<BackendConnectionConfig>;
  syncNow(): Promise<DesktopSnapshot>;
}

const browserFallback: DesktopApi = {
  async getSnapshot() {
    return {
      workspace: {
        id: "browser",
        name: "Browser Preview",
        rootPath: "~/Documents/Slate",
        connected: false
      },
      backend: {
        endpoint: "localhost:50051",
        clientId: "browser-preview",
        connected: false
      },
      notes: []
    };
  },
  async chooseWorkspaceDirectory() {
    return {
      id: "browser",
      name: "Browser Preview",
      rootPath: "~/Documents/Slate",
      connected: false
    };
  },
  async createNote() {
    const now = new Date().toISOString();
    return {
      id: "browser-note",
      title: "Untitled note",
      path: "untitled-note.md",
      preview: "Browser preview mode does not persist local files.",
      markdown: "# Untitled note\n",
      plainText: "Untitled note",
      updatedAt: now,
      acceptedRevision: 0,
      deleted: false,
      syncState: "offline"
    };
  },
  async loadNote(noteId: string) {
    return {
      id: noteId,
      title: "Untitled note",
      path: "untitled-note.md",
      preview: "Browser preview mode does not persist local files.",
      markdown: "# Untitled note\n",
      plainText: "Untitled note",
      updatedAt: new Date().toISOString(),
      acceptedRevision: 0,
      deleted: false,
      syncState: "offline"
    };
  },
  async saveNote(payload) {
    return {
      ...(await browserFallback.loadNote(payload.id)),
      title: payload.title,
      markdown: payload.markdown
    };
  },
  async deleteNote() {
    return;
  },
  async renameFolder() {
    return;
  },
  async deleteFolder() {
    return;
  },
  async connectBackend() {
    return {
      endpoint: "localhost:50051",
      clientId: "browser-preview",
      connected: false
    };
  },
  async syncNow() {
    return browserFallback.getSnapshot();
  }
};

function desktopApi(): DesktopApi {
  return (window as Window & { slateDesktop?: DesktopApi }).slateDesktop ?? browserFallback;
}

export function getSnapshot() {
  return desktopApi().getSnapshot();
}

export function chooseWorkspaceDirectory() {
  return desktopApi().chooseWorkspaceDirectory();
}

export function createNote(parentPath?: string) {
  return desktopApi().createNote(parentPath);
}

export function loadNote(noteId: string) {
  return desktopApi().loadNote(noteId);
}

export function saveNote(payload: { id: string; title: string; markdown: string }) {
  return desktopApi().saveNote(payload);
}

export function deleteNote(noteId: string) {
  return desktopApi().deleteNote(noteId);
}

export function renameFolder(folderPath: string, nextName: string) {
  return desktopApi().renameFolder(folderPath, nextName);
}

export function deleteFolder(folderPath: string) {
  return desktopApi().deleteFolder(folderPath);
}

export function connectBackend() {
  return desktopApi().connectBackend();
}

export function syncNow() {
  return desktopApi().syncNow();
}
