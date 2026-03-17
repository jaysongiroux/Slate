import type { BackendConnectionConfig, DesktopSnapshot, LocalNoteSummary, LocalWorkspaceProfile } from "@slate/shared/index";

interface DesktopApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  chooseWorkspaceDirectory(): Promise<LocalWorkspaceProfile>;
  createNote(parentPath?: string): Promise<LocalNoteSummary>;
  createFolder(parentPath?: string): Promise<string>;
  loadNote(noteId: string): Promise<LocalNoteSummary>;
  saveNote(payload: { id: string; title: string; markdown: string }): Promise<LocalNoteSummary>;
  deleteNote(noteId: string): Promise<void>;
  renameFolder(folderPath: string, nextName: string): Promise<void>;
  deleteFolder(folderPath: string): Promise<void>;
  setBackendEndpoint(endpoint: string): Promise<BackendConnectionConfig>;
  checkBackendConnection(endpoint: string): Promise<boolean>;
  refreshBackendStatus(): Promise<BackendConnectionConfig>;
  loginWithPassword(payload: { email: string; password: string; totpCode?: string }): Promise<BackendConnectionConfig>;
  loginWithOidc(providerId: string): Promise<BackendConnectionConfig>;
  cancelOidc(): Promise<void>;
  uploadAttachment(payload: {
    buffer: ArrayBuffer;
    fileName: string;
    mimeType: string;
    workspaceId: string;
    documentId: string;
  }): Promise<{ id: string; contentUrl: string }>;
  resolveAttachmentUrl(contentUrl: string): Promise<string>;
  signOutBackend(): Promise<BackendConnectionConfig>;
  connectBackend(): Promise<BackendConnectionConfig>;
  syncNow(): Promise<DesktopSnapshot>;
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>;
}

export interface ContextMenuItem {
  id?: string;
  label?: string;
  type?: "separator";
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
        backendReachable: false,
        authStatus: "signed_out",
        authProviders: []
      },
      notes: [],
      folders: []
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
  async createFolder() {
    return "untitled-folder";
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
  async setBackendEndpoint() {
    return {
      endpoint: "localhost:50051",
      clientId: "browser-preview",
      backendReachable: false,
      authStatus: "signed_out",
      authProviders: []
    };
  },
  async checkBackendConnection() {
    return false;
  },
  async refreshBackendStatus() {
    return {
      endpoint: "localhost:50051",
      clientId: "browser-preview",
      backendReachable: false,
      authStatus: "signed_out",
      authProviders: []
    };
  },
  async loginWithPassword() {
    return {
      endpoint: "localhost:50051",
      clientId: "browser-preview",
      backendReachable: false,
      authStatus: "signed_out",
      authProviders: []
    };
  },
  async loginWithOidc() {
    return {
      endpoint: "localhost:50051",
      clientId: "browser-preview",
      backendReachable: false,
      authStatus: "signed_out",
      authProviders: []
    };
  },
  async cancelOidc() {
    return;
  },
  async uploadAttachment() {
    return { id: "browser-stub", contentUrl: "/api/attachments/browser-stub/content" };
  },
  async resolveAttachmentUrl(contentUrl: string) {
    return contentUrl;
  },
  async signOutBackend() {
    return {
      endpoint: "localhost:50051",
      clientId: "browser-preview",
      backendReachable: false,
      authStatus: "signed_out",
      authProviders: []
    };
  },
  async connectBackend() {
    return {
      endpoint: "localhost:50051",
      clientId: "browser-preview",
      backendReachable: false,
      authStatus: "signed_out",
      authProviders: []
    };
  },
  async syncNow() {
    return browserFallback.getSnapshot();
  },
  async showContextMenu() {
    return null;
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

export function createFolder(parentPath?: string) {
  return desktopApi().createFolder(parentPath);
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

export function setBackendEndpoint(endpoint: string) {
  return desktopApi().setBackendEndpoint(endpoint);
}

export function checkBackendConnection(endpoint: string) {
  return desktopApi().checkBackendConnection(endpoint);
}

export function refreshBackendStatus() {
  return desktopApi().refreshBackendStatus();
}

export function loginWithPassword(payload: { email: string; password: string; totpCode?: string }) {
  return desktopApi().loginWithPassword(payload);
}

export function loginWithOidc(providerId: string) {
  return desktopApi().loginWithOidc(providerId);
}

export function cancelOidc() {
  return desktopApi().cancelOidc();
}

export function uploadAttachment(payload: {
  buffer: ArrayBuffer;
  fileName: string;
  mimeType: string;
  workspaceId: string;
  documentId: string;
}) {
  return desktopApi().uploadAttachment(payload);
}

export function resolveAttachmentUrl(contentUrl: string) {
  return desktopApi().resolveAttachmentUrl(contentUrl);
}

export function signOutBackend() {
  return desktopApi().signOutBackend();
}

export function connectBackend() {
  return desktopApi().connectBackend();
}

export function syncNow() {
  return desktopApi().syncNow();
}

export function showContextMenu(items: ContextMenuItem[]) {
  return desktopApi().showContextMenu(items);
}
