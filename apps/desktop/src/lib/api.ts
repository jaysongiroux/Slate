import type { BackendConnectionConfig, DesktopSnapshot, LocalLibraryProfile, LocalNoteSummary } from "@slate/shared/index";

export interface AiConfigResponse {
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingEndpoint?: string;
  hasEmbeddingApiKey: boolean;
  chatProvider?: string;
  chatModel?: string;
  chatEndpoint?: string;
  hasChatApiKey: boolean;
}

export interface UpdateAiConfigRequest {
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingEndpoint?: string;
  embeddingApiKey?: string;
  chatProvider?: string;
  chatModel?: string;
  chatEndpoint?: string;
  chatApiKey?: string;
}

export interface ConversationResponse {
  id: string;
  title?: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageResponse {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  createdAt: string;
}

export interface SendMessageEvent {
  type: 'token' | 'tool_call' | 'done';
  content?: string;
  toolName?: string;
}

interface DesktopApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  chooseWorkspaceDirectory(): Promise<LocalLibraryProfile>;
  createNote(parentPath?: string): Promise<LocalNoteSummary>;
  createDailyNote(): Promise<LocalNoteSummary>;
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
    documentId: string;
  }): Promise<{ id: string; contentUrl: string }>;
  resolveAttachmentUrl(contentUrl: string): Promise<string>;
  signOutBackend(): Promise<BackendConnectionConfig>;
  connectBackend(): Promise<BackendConnectionConfig>;
  syncNow(): Promise<DesktopSnapshot>;
  fullSync(): Promise<DesktopSnapshot>;
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>;
  getLastOpenNoteId(): Promise<string | null>;
  setLastOpenNoteId(noteId: string): Promise<void>;
  getKeyboardShortcuts(): Promise<{ action: string; shortcut: string }[]>;
  setKeyboardShortcut(action: string, shortcut: string): Promise<void>;
  onWorkspaceChanged?(callback: () => void): void;
  offWorkspaceChanged?(): void;
  onSyncStatus?(callback: (status: string) => void): void;
  offSyncStatus?(): void;
  openExternal(url: string): Promise<void>;
  getAiConfig(): Promise<AiConfigResponse>;
  updateAiConfig(config: UpdateAiConfigRequest): Promise<AiConfigResponse>;
  createConversation(): Promise<ConversationResponse>;
  listConversations(): Promise<ConversationResponse[]>;
  deleteConversation(id: string): Promise<void>;
  getConversationMessages(conversationId: string): Promise<ChatMessageResponse[]>;
  sendMessage(conversationId: string, content: string, onEvent: (event: SendMessageEvent) => void): Promise<void>;
  triggerEmbedding(): Promise<{ documentsQueued: number }>;
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
  async createDailyNote() {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return {
      id: "browser-daily",
      title: dateStr,
      path: `${dateStr}.md`,
      preview: "Browser preview mode does not persist local files.",
      markdown: `# ${dateStr}\n`,
      plainText: dateStr,
      updatedAt: now.toISOString(),
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
  async fullSync() {
    return browserFallback.getSnapshot();
  },
  async showContextMenu() {
    return null;
  },
  async getLastOpenNoteId() {
    return null;
  },
  async setLastOpenNoteId() {
    return;
  },
  async getKeyboardShortcuts() {
    return [];
  },
  async setKeyboardShortcut() {
    return;
  },
  onWorkspaceChanged() {
    return;
  },
  offWorkspaceChanged() {
    return;
  },
  onSyncStatus() {
    return;
  },
  offSyncStatus() {
    return;
  },
  async openExternal(url: string) {
    window.open(url, "_blank");
  },
  async getAiConfig() { return { hasEmbeddingApiKey: false, hasChatApiKey: false }; },
  async updateAiConfig() { return { hasEmbeddingApiKey: false, hasChatApiKey: false }; },
  async createConversation() { return { id: '', messageCount: 0, createdAt: '', updatedAt: '' }; },
  async listConversations() { return []; },
  async deleteConversation() { return; },
  async getConversationMessages() { return []; },
  async sendMessage() { return; },
  async triggerEmbedding() { return { documentsQueued: 0 }; },
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

export function createDailyNote() {
  return desktopApi().createDailyNote();
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

export function fullSync() {
  return desktopApi().fullSync();
}

export function showContextMenu(items: ContextMenuItem[]) {
  return desktopApi().showContextMenu(items);
}

export function getLastOpenNoteId() {
  return desktopApi().getLastOpenNoteId();
}

export function setLastOpenNoteId(noteId: string) {
  return desktopApi().setLastOpenNoteId(noteId);
}

export function getKeyboardShortcuts() {
  return desktopApi().getKeyboardShortcuts();
}

export function setKeyboardShortcut(action: string, shortcut: string) {
  return desktopApi().setKeyboardShortcut(action, shortcut);
}

export function openExternal(url: string) {
  return desktopApi().openExternal(url);
}

export function getAiConfig() { return desktopApi().getAiConfig(); }
export function updateAiConfig(config: UpdateAiConfigRequest) { return desktopApi().updateAiConfig(config); }
export function createConversation() { return desktopApi().createConversation(); }
export function listConversations() { return desktopApi().listConversations(); }
export function deleteConversation(id: string) { return desktopApi().deleteConversation(id); }
export function getConversationMessages(conversationId: string) { return desktopApi().getConversationMessages(conversationId); }
export function sendMessage(conversationId: string, content: string, onEvent: (event: SendMessageEvent) => void) { return desktopApi().sendMessage(conversationId, content, onEvent); }
export function triggerEmbedding() { return desktopApi().triggerEmbedding(); }
