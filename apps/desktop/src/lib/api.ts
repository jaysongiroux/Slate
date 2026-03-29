import type {
  BackendConnectionConfig,
  DesktopSnapshot,
  LocalLibraryProfile,
  LocalNoteSummary,
} from "@slate/shared";

export interface AiConfigResponse {
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingEndpoint?: string;
  hasEmbeddingApiKey: boolean;
  chatProvider?: string;
  chatModel?: string;
  chatEndpoint?: string;
  hasChatApiKey: boolean;
  /** Present after UpdateAiConfig: true when chat model/provider/endpoint/key changed. */
  chatStreamingConfigChanged?: boolean;
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
  type: 'token' | 'tool_call' | 'done' | 'error'
    | 'note_create_start' | 'note_edit_start' | 'note_delta' | 'note_done';
  content?: string;
  toolName?: string;
  documentId?: string;
  title?: string;
  path?: string;
  error?: string;
}

/** Main-process return value for `sendMessage` invoke (success = event list, stop = cancelled). */
export type SendMessageInvokeResult = SendMessageEvent[] | { cancelled: true };

export function isSendMessageCancelled(value: unknown): value is { cancelled: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "cancelled" in value &&
    (value as { cancelled: unknown }).cancelled === true
  );
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
  togglePinNote(noteId: string, pinned: boolean): Promise<void>;
  rescanNote(noteId: string): Promise<void>;
  /** Empty string moves the note to the workspace root (top level). */
  moveNote(noteId: string, targetFolderPath: string): Promise<LocalNoteSummary>;
  renameFolder(folderPath: string, nextName: string): Promise<void>;
  /** Empty string moves the folder to the workspace root (top level). */
  moveFolder(folderPath: string, targetParentPath: string): Promise<void>;
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
  getLastActiveChatConversationId(): Promise<string | null>;
  setLastActiveChatConversationId(conversationId: string | null): Promise<void>;
  getKeyboardShortcuts(): Promise<{ action: string; shortcut: string }[]>;
  setKeyboardShortcut(action: string, shortcut: string): Promise<void>;
  onWorkspaceChanged?(callback: (diskRelPaths: string[]) => void): void;
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
  sendMessage(
    conversationId: string,
    content: string,
    onEvent: (event: SendMessageEvent) => void,
  ): Promise<SendMessageInvokeResult>;
  cancelSendMessage(): Promise<void>;
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
      syncState: "offline",
      pinned: false
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
      syncState: "offline",
      pinned: false
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
      syncState: "offline",
      pinned: false
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
  async togglePinNote() {
    return;
  },
  async rescanNote() {
    return;
  },
  async moveNote(noteId: string) {
    return browserFallback.loadNote(noteId);
  },
  async renameFolder() {
    return;
  },
  async moveFolder() {
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
  async getLastActiveChatConversationId() {
    return null;
  },
  async setLastActiveChatConversationId() {
    return;
  },
  async getKeyboardShortcuts() {
    return [];
  },
  async setKeyboardShortcut() {
    return;
  },
  onWorkspaceChanged(_callback: (diskRelPaths: string[]) => void) {
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
  async sendMessage() {
    return [] as SendMessageEvent[];
  },
  async cancelSendMessage() { return; },
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

export function rescanNote(noteId: string): Promise<void> {
  return desktopApi().rescanNote(noteId);
}

export function togglePinNote(noteId: string, pinned: boolean): Promise<void> {
  return desktopApi().togglePinNote(noteId, pinned);
}

export function moveNote(noteId: string, targetFolderPath: string) {
  return desktopApi().moveNote(noteId, targetFolderPath);
}

export function renameFolder(folderPath: string, nextName: string) {
  return desktopApi().renameFolder(folderPath, nextName);
}

export function moveFolder(folderPath: string, targetParentPath: string) {
  return desktopApi().moveFolder(folderPath, targetParentPath);
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

export function getLastActiveChatConversationId() {
  return desktopApi().getLastActiveChatConversationId();
}

export function setLastActiveChatConversationId(conversationId: string | null) {
  return desktopApi().setLastActiveChatConversationId(conversationId);
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
export function cancelSendMessage() { return desktopApi().cancelSendMessage(); }
export function triggerEmbedding() { return desktopApi().triggerEmbedding(); }
