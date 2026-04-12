import type {
  BackendConnectionConfig,
  DesktopSnapshot,
  LocalLibraryProfile,
  LocalNoteSummary,
} from "@slate/shared";
import type { SidebarMode } from "../../components/IconRail";

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
  /** Present after UpdateAiConfig: true when embedding model/provider changed. */
  embeddingModelOrProviderChanged?: boolean;
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

export interface EmbedStatusResponse {
  total: number;
  embedded: number;
  remaining: number;
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
  role: "USER" | "ASSISTANT";
  content: string;
  metadata?: {
    kind?: string;
    toolName?: string;
  } | null;
  createdAt: string;
}

export interface SendMessageEvent {
  type:
    | "token"
    | "tool_call"
    | "done"
    | "error"
    | "note_create_start"
    | "note_edit_start"
    | "note_delta"
    | "note_done";
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

/** Payloads returned from Electron when importing without a main-process note store (RxDB). */
export interface MarkdownImportNotePayload {
  id: string;
  path: string;
  title: string;
  markdown: string;
  plainText: string;
  isTemplate: boolean;
}

export type MarkdownImportResult = {
  total: number;
  imported: number;
  errors: number;
  notes?: MarkdownImportNotePayload[];
};

interface DesktopApi {
  /** Optional: forwards structured lines to main-process `logs/slate-desktop.log`. */
  writeDiagLog?(payload: Record<string, unknown> | string): Promise<void>;
  getSnapshot(): Promise<DesktopSnapshot>;
  createNote(parentPath?: string, name?: string): Promise<LocalNoteSummary>;
  createDailyNote(): Promise<LocalNoteSummary>;
  createFolder(parentPath?: string, name?: string): Promise<string>;
  listTemplates(): Promise<LocalNoteSummary[]>;
  createTemplate(parentPath?: string, name?: string): Promise<LocalNoteSummary>;
  readTemplateContent(relativePath: string): Promise<string | null>;
  loadNote(noteId: string): Promise<LocalNoteSummary>;
  getNoteCrdtState(noteId: string): Promise<Uint8Array | null>;
  saveNote(payload: {
    id: string;
    title: string;
    markdown: string;
  }): Promise<LocalNoteSummary | null>;
  updateNotePlainText(noteId: string, plainText: string): Promise<void>;
  importFolder(): Promise<MarkdownImportResult | null>;
  importFiles(): Promise<MarkdownImportResult | null>;
  saveZipExport(payload: {
    defaultFilename: string;
    data: Uint8Array;
  }): Promise<{ ok: true; path: string } | { canceled: true }>;
  deleteNote(noteId: string): Promise<void>;
  togglePinNote(noteId: string, pinned: boolean): Promise<void>;
  rescanNote(noteId: string): Promise<void>;
  renameNote(noteId: string, nextTitle: string): Promise<LocalNoteSummary>;
  /** Empty string moves the note to the workspace root (top level). */
  moveNote(noteId: string, targetFolderPath: string): Promise<LocalNoteSummary>;
  renameFolder(folderPath: string, nextName: string): Promise<void>;
  /** Empty string moves the folder to the workspace root (top level). */
  moveFolder(folderPath: string, targetParentPath: string): Promise<void>;
  deleteFolder(folderPath: string): Promise<void>;
  setBackendEndpoint(endpoint: string): Promise<BackendConnectionConfig>;
  checkBackendConnection(endpoint: string): Promise<boolean>;
  refreshBackendStatus(): Promise<BackendConnectionConfig>;
  loginWithPassword(payload: {
    email: string;
    password: string;
    totpCode?: string;
  }): Promise<BackendConnectionConfig>;
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
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>;
  getLastOpenNoteId(): Promise<string | null>;
  setLastOpenNoteId(noteId: string): Promise<void>;
  getLastSidebarMode(): Promise<SidebarMode | null>;
  setLastSidebarMode(mode: SidebarMode): Promise<void>;
  getCalendarVisibilityFilters(): Promise<CalendarVisibilityFilters | null>;
  setCalendarVisibilityFilters(payload: CalendarVisibilityFilters): Promise<void>;
  getCalendarReminderSettings(): Promise<CalendarReminderSettings>;
  setCalendarReminderSettings(payload: CalendarReminderSettings): Promise<void>;
  getLastCalendarView(): Promise<string | null>;
  setLastCalendarView(view: string): Promise<void>;
  getLastCalendarDate(): Promise<string | null>;
  setLastCalendarDate(date: string): Promise<void>;
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
    enabledCalendarIds?: string[],
    enabledIcsIds?: string[],
    timezone?: string,
  ): Promise<SendMessageInvokeResult>;
  cancelSendMessage(): Promise<void>;
  triggerEmbedding(): Promise<{ documentsQueued: number }>;
  getEmbedStatus(): Promise<EmbedStatusResponse>;
  // Calendar
  getCalendarStatus(): Promise<CalendarStatusResponse>;
  startCalendarOAuth(payload: {
    providerId: string;
  }): Promise<{ authorizationUrl: string; state: string }>;
  disconnectCalendar(payload: { connectionId: string }): Promise<void>;
  listCalendars(payload: { connectionId: string }): Promise<{ calendars: AvailableCalendar[] }>;
  subscribeCalendar(payload: {
    connectionId: string;
    calendarId: string;
    name: string;
    color?: string;
  }): Promise<{ subscription: CalendarSubscriptionInfo }>;
  unsubscribeCalendar(payload: { subscriptionId: string }): Promise<void>;
  updateCalendarSubscription(payload: {
    subscriptionId: string;
    color?: string;
    enabled?: boolean;
  }): Promise<{ subscription: CalendarSubscriptionInfo }>;
  addIcsSubscription(payload: {
    url: string;
    name: string;
    color?: string;
  }): Promise<{ subscription: IcsSubscriptionInfo }>;
  removeIcsSubscription(payload: { id: string }): Promise<void>;
  updateIcsSubscription(payload: {
    id: string;
    name?: string;
    color?: string;
    enabled?: boolean;
  }): Promise<{ subscription: IcsSubscriptionInfo }>;
  fetchCalendarEvents(payload: {
    timeMin: string;
    timeMax: string;
  }): Promise<{ events: CalendarEvent[] }>;
  createCalendarEvent(payload: {
    subscriptionId: string;
    title: string;
    description?: string;
    location?: string;
    startTime: string;
    endTime: string;
    allDay: boolean;
  }): Promise<{ event: CalendarEvent }>;
  updateCalendarEvent(payload: {
    subscriptionId: string;
    eventId: string;
    title?: string;
    description?: string;
    location?: string;
    startTime?: string;
    endTime?: string;
    allDay?: boolean;
  }): Promise<{ event: CalendarEvent }>;
  deleteCalendarEvent(payload: { subscriptionId: string; eventId: string }): Promise<void>;
  rsvpCalendarEvent(payload: {
    subscriptionId: string;
    eventId: string;
    response: string;
  }): Promise<void>;
}

// ── Calendar types ──

export interface CalendarProviderInfo {
  providerId: string;
  label: string;
  configured: boolean;
}

export interface CalendarConnectionInfo {
  id: string;
  provider: string;
  email: string;
  calendars: CalendarSubscriptionInfo[];
}

export interface CalendarSubscriptionInfo {
  subscriptionId: string;
  calendarId: string;
  name: string;
  color: string;
  enabled: boolean;
}

export interface IcsSubscriptionInfo {
  id: string;
  url: string;
  name: string;
  color: string;
  enabled: boolean;
}

export interface AvailableCalendar {
  calendarId: string;
  name: string;
  color: string;
  isPrimary: boolean;
}

export interface CalendarEvent {
  id: string;
  subscriptionId?: string;
  calendarId: string;
  calendarName?: string;
  source: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  color: string;
  htmlLink?: string;
  readOnly: boolean;
}

export interface CalendarStatusResponse {
  providers: CalendarProviderInfo[];
  connections: CalendarConnectionInfo[];
  icsSubscriptions: IcsSubscriptionInfo[];
}

export interface ContextMenuItem {
  id?: string;
  label?: string;
  type?: "separator";
}

export interface CalendarVisibilityFilters {
  selectedCalendarIds: string[];
  selectedIcsIds: string[];
  knownCalendarIds?: string[];
  knownIcsIds?: string[];
  /** When false, ISO-titled daily notes are hidden on the calendar. Default: shown. */
  showDailyNotes?: boolean;
}

export interface CalendarReminderSettings {
  enabled: boolean;
  minutesBeforeStart: number;
  playSound: boolean;
  enabledCalendarIds: string[] | null;
}

const browserFallback: DesktopApi = {
  async writeDiagLog() {
    return;
  },
  async getSnapshot() {
    return {
      backend: {
        endpoint: "localhost:4000",
        clientId: "browser-preview",
        backendReachable: false,
        authStatus: "signed_out",
        authProviders: [],
      },
      notes: [],
      folders: [],
    };
  },
  async createFolder(_parentPath, name) {
    return (name ?? "untitled-folder").toLowerCase().replace(/\s+/g, "-");
  },
  async createNote(_parentPath, name) {
    const now = new Date().toISOString();
    const title = name?.trim() || "Untitled note";
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    return {
      id: "browser-note",
      title,
      path: slug || "untitled-note",
      pinned: false,
      isTemplate: false,
      deleted: false,
      updatedAt: now,
      createdAt: now,
    };
  },
  async listTemplates() {
    return [];
  },
  async createTemplate(_parentPath, name) {
    const now = new Date().toISOString();
    const title = name?.trim() || "Untitled template";
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    return {
      id: "browser-template",
      title,
      path: `templates/${slug || "untitled-template"}`,
      pinned: false,
      isTemplate: true,
      updatedAt: now,
      createdAt: now,
      deleted: false,
    };
  },
  async readTemplateContent() {
    return null;
  },
  async createDailyNote() {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return {
      id: "browser-daily",
      title: dateStr,
      path: `daily/${dateStr}`,
      pinned: false,
      isTemplate: false,
      deleted: false,
      updatedAt: now.toISOString(),
      createdAt: now.toISOString(),
    };
  },
  async loadNote(noteId: string) {
    return {
      id: noteId,
      title: "Untitled note",
      path: "untitled-note",
      pinned: false,
      isTemplate: false,
      deleted: false,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  },
  async getNoteCrdtState(_noteId: string) {
    return null;
  },
  async saveNote(_payload) {
    return null;
  },
  async updateNotePlainText(_noteId: string, _plainText: string) {
    return;
  },
  async importFolder() {
    return null;
  },
  async importFiles() {
    return null;
  },
  async saveZipExport() {
    return { canceled: true };
  },
  async deleteNote() {
    return;
  },
  async renameNote(noteId, nextTitle) {
    const now = new Date().toISOString();
    const title = nextTitle?.trim() || "Untitled note";
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    return {
      id: noteId,
      title,
      path: slug || "untitled-note",
      pinned: false,
      isTemplate: false,
      deleted: false,
      updatedAt: now,
      createdAt: now,
    };
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
      endpoint: "localhost:4000",
      clientId: "browser-preview",
      backendReachable: false,
      authStatus: "signed_out",
      authProviders: [],
    };
  },
  async checkBackendConnection() {
    return false;
  },
  async refreshBackendStatus() {
    return {
      endpoint: "localhost:4000",
      clientId: "browser-preview",
      backendReachable: false,
      authStatus: "signed_out",
      authProviders: [],
    };
  },
  async loginWithPassword() {
    return {
      endpoint: "localhost:4000",
      clientId: "browser-preview",
      backendReachable: false,
      authStatus: "signed_out",
      authProviders: [],
    };
  },
  async loginWithOidc() {
    return {
      endpoint: "localhost:4000",
      clientId: "browser-preview",
      backendReachable: false,
      authStatus: "signed_out",
      authProviders: [],
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
      endpoint: "localhost:4000",
      clientId: "browser-preview",
      backendReachable: false,
      authStatus: "signed_out",
      authProviders: [],
    };
  },
  async connectBackend() {
    return {
      endpoint: "localhost:4000",
      clientId: "browser-preview",
      backendReachable: false,
      authStatus: "signed_out",
      authProviders: [],
    };
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
  async getLastSidebarMode() {
    return null;
  },
  async setLastSidebarMode() {
    return;
  },
  async getCalendarVisibilityFilters() {
    return null;
  },
  async setCalendarVisibilityFilters() {
    return;
  },
  async getCalendarReminderSettings() {
    return {
      enabled: false,
      minutesBeforeStart: 10,
      playSound: true,
      enabledCalendarIds: null,
    };
  },
  async setCalendarReminderSettings() {
    return;
  },
  async getLastCalendarView() {
    return null;
  },
  async setLastCalendarView() {
    return;
  },
  async getLastCalendarDate() {
    return null;
  },
  async setLastCalendarDate() {
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
  async getAiConfig() {
    return { hasEmbeddingApiKey: false, hasChatApiKey: false };
  },
  async updateAiConfig() {
    return { hasEmbeddingApiKey: false, hasChatApiKey: false };
  },
  async createConversation() {
    return { id: "", messageCount: 0, createdAt: "", updatedAt: "" };
  },
  async listConversations() {
    return [];
  },
  async deleteConversation() {
    return;
  },
  async getConversationMessages() {
    return [];
  },
  async sendMessage() {
    return [] as SendMessageEvent[];
  },
  async cancelSendMessage() {
    return;
  },
  async triggerEmbedding() {
    return { documentsQueued: 0 };
  },
  async getEmbedStatus() {
    return { total: 0, embedded: 0, remaining: 0 };
  },
  // Calendar stubs
  async getCalendarStatus() {
    return { providers: [], connections: [], icsSubscriptions: [] };
  },
  async startCalendarOAuth() {
    return { authorizationUrl: "", state: "" };
  },
  async disconnectCalendar() {
    return;
  },
  async listCalendars() {
    return { calendars: [] };
  },
  async subscribeCalendar() {
    return {
      subscription: { subscriptionId: "", calendarId: "", name: "", color: "", enabled: false },
    };
  },
  async unsubscribeCalendar() {
    return;
  },
  async updateCalendarSubscription() {
    return {
      subscription: { subscriptionId: "", calendarId: "", name: "", color: "", enabled: false },
    };
  },
  async addIcsSubscription() {
    return { subscription: { id: "", url: "", name: "", color: "", enabled: false } };
  },
  async removeIcsSubscription() {
    return;
  },
  async updateIcsSubscription() {
    return { subscription: { id: "", url: "", name: "", color: "", enabled: false } };
  },
  async fetchCalendarEvents() {
    return { events: [] };
  },
  async createCalendarEvent() {
    return {
      event: {
        id: "",
        subscriptionId: "",
        calendarId: "",
        source: "",
        title: "",
        startTime: "",
        endTime: "",
        allDay: false,
        color: "",
        readOnly: false,
      },
    };
  },
  async updateCalendarEvent() {
    return {
      event: {
        id: "",
        subscriptionId: "",
        calendarId: "",
        source: "",
        title: "",
        startTime: "",
        endTime: "",
        allDay: false,
        color: "",
        readOnly: false,
      },
    };
  },
  async deleteCalendarEvent() {
    return;
  },
  async rsvpCalendarEvent() {
    return;
  },
};

export function desktopApi(): DesktopApi {
  return (window as Window & { slateDesktop?: DesktopApi }).slateDesktop ?? browserFallback;
}
