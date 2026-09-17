import type {
  BackendConnectionConfig,
  CalendarAttendeeInput,
  CalendarAttendeeSuggestion,
  DesktopSnapshot,
  HomeAssistantAreaSummary,
  HomeAssistantControlRequest,
  HomeAssistantControlResult,
  HomeAssistantDashboardEntitySummary,
  HomeAssistantDashboardSummary,
  HomeAssistantDeviceSummary,
  HomeAssistantEntityHistoryResult,
  HomeAssistantEntitySummary,
  HomeAssistantInstance,
  HomeAssistantLiveEvent,
  HomeAssistantState,
  JiraBoard,
  JiraBoardColumn,
  JiraComment,
  JiraFieldMeta,
  JiraInstance,
  JiraInstanceType,
  JiraIssue,
  JiraIssueType,
  JiraIssuesResponse,
  JiraPriority,
  JiraProjectsResponse,
  JiraSprint,
  JiraTransition,
  JiraUser,
  SavedJqlQuery,
  LinkwardenCollectionsResponse,
  LinkwardenInstance,
  LinkwardenLinksResponse,
  LinkwardenTagsResponse,
  ForgeInstance,
  ForgeCounts,
  ForgeRepo,
  ForgePullRequest,
  ForgeIssue,
  ForgeNotification,
  ForgePinnedItem,
  ForgePinnedItemStatus,
  ForgeSavedSearch,
  Paged,
  LocalNoteSummary,
} from "@slate/shared";
import type { SidebarMode } from "../../components/IconRail";
import type { DiagramRecord, DiagramScene, DiagramSummary } from "./diagrams-api";

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
  jobActive: boolean;
}

export interface NoteGraphPayload {
  nodes: { id: string; title: string; preview: string }[];
  edges: { source: string; target: string; score: number }[];
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

/**
 * Why a chat turn failed. Provider codes come from the backend classifier;
 * backend/session codes are raised by the desktop transport itself.
 */
export type ChatErrorCode =
  | "provider_no_credits"
  | "provider_rate_limited"
  | "provider_auth"
  | "provider_model_unavailable"
  | "provider_context_length"
  | "provider_unavailable"
  | "backend_unreachable"
  | "backend_error"
  | "session_expired"
  | "unknown";

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
  /** Error events only. */
  code?: ChatErrorCode;
  detail?: string;
  actionUrl?: string;
  retryable?: boolean;
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

export interface AppLogEvent {
  type: "initial" | "append";
  chunk: string;
  path: string;
}

export interface AppLogSubscription {
  subscriptionId: string;
  path: string;
  unsubscribe: () => Promise<unknown>;
}

interface DesktopApi {
  /** Optional: forwards structured lines to main-process `logs/slate-desktop.log`. */
  writeDiagLog?(payload: Record<string, unknown> | string): Promise<void>;
  subscribeAppLog?(onEvent: (event: AppLogEvent) => void): Promise<AppLogSubscription>;
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
    containerType: "note" | "diagram";
    containerId: string;
  }): Promise<{ id: string; contentUrl: string }>;
  resolveAttachmentUrl(contentUrl: string): Promise<string>;
  signOutBackend(): Promise<BackendConnectionConfig>;
  connectBackend(): Promise<BackendConnectionConfig>;
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>;
  onCopySelectionAsMarkdown?(callback: () => void): void;
  offCopySelectionAsMarkdown?(): void;
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
    options?: { retry?: boolean },
  ): Promise<SendMessageInvokeResult>;
  cancelSendMessage(): Promise<void>;
  triggerEmbedding(): Promise<{ documentsQueued: number }>;
  triggerPendingEmbedding(): Promise<{ documentsQueued: number }>;
  getEmbedStatus(): Promise<EmbedStatusResponse>;
  /** Returns `null` when the extension is off on the server (404). */
  getNoteGraph(): Promise<NoteGraphPayload | null>;
  deleteNoteGraphEdges(): Promise<{ ok: boolean }>;
  enqueueNoteGraphRebuild(): Promise<{ ok: boolean; enqueued: boolean }>;
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
  searchCalendarAttendees(payload: {
    subscriptionId: string;
    query: string;
  }): Promise<{ attendees: CalendarAttendeeSuggestion[] }>;
  createCalendarEvent(payload: {
    subscriptionId: string;
    title: string;
    description?: string;
    location?: string;
    startTime: string;
    endTime: string;
    allDay: boolean;
    attendees?: CalendarAttendeeInput[];
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
    attendees?: CalendarAttendeeInput[];
  }): Promise<{ event: CalendarEvent }>;
  deleteCalendarEvent(payload: { subscriptionId: string; eventId: string }): Promise<void>;
  rsvpCalendarEvent(payload: {
    subscriptionId: string;
    eventId: string;
    response: string;
  }): Promise<void>;
  flushContactCache(): Promise<void>;
  // LinkWarden
  getLinkwardenInstances(): Promise<{ instances: LinkwardenInstance[] }>;
  addLinkwardenInstance(payload: {
    url: string;
    token: string;
    name?: string;
  }): Promise<{ instance: LinkwardenInstance }>;
  removeLinkwardenInstance(payload: { id: string }): Promise<{ ok: boolean }>;
  getLinkwardenLinks(payload: {
    instanceId: string;
    collectionId?: number;
    tagId?: number;
    searchQueryString?: string;
    cursor?: number;
    sort?: number;
  }): Promise<LinkwardenLinksResponse>;
  getLinkwardenCollections(payload: { instanceId: string }): Promise<LinkwardenCollectionsResponse>;
  getLinkwardenTags(payload: { instanceId: string }): Promise<LinkwardenTagsResponse>;
  getLinkwardenDashboard(payload: { instanceId: string }): Promise<unknown>;
  createLinkwardenLink(payload: {
    instanceId: string;
    url: string;
    name?: string;
    description?: string;
    collection?: { id: number };
    tags?: string[];
  }): Promise<unknown>;
  resolveLinkwardenPreviewUrl(payload: { instanceId: string; linkId: number }): Promise<string>;
  // Forge (GitHub / GitLab)
  getForgeInstances(): Promise<{ instances: ForgeInstance[] }>;
  addForgeInstance(payload: {
    provider: "github" | "gitlab";
    baseUrl: string;
    token: string;
    name?: string;
  }): Promise<{ instance: ForgeInstance }>;
  updateForgeInstance(payload: {
    id: string;
    name?: string;
    baseUrl?: string;
    provider?: "github" | "gitlab";
    token?: string;
  }): Promise<{ instance: ForgeInstance }>;
  removeForgeInstance(payload: { id: string }): Promise<{ ok: boolean }>;
  getForgeCounts(payload: { instanceId: string }): Promise<ForgeCounts>;
  getForgeList(payload: {
    instanceId: string;
    kind: "my-prs" | "reviewing" | "notifications" | "assigned-issues" | "repos";
    cursor?: string;
  }): Promise<Paged<ForgePullRequest | ForgeIssue | ForgeNotification | ForgeRepo>>;
  getForgeRepoPRs(payload: {
    instanceId: string;
    owner: string;
    repo: string;
    cursor?: string;
  }): Promise<Paged<ForgePullRequest>>;
  getForgeRepoIssues(payload: {
    instanceId: string;
    owner: string;
    repo: string;
    cursor?: string;
  }): Promise<Paged<ForgeIssue>>;
  getForgePinned(payload: { instanceId: string }): Promise<{ items: ForgePinnedItem[] }>;
  addForgePinned(payload: {
    instanceId: string;
    kind: "pr" | "issue";
    repo: string;
    number: number;
  }): Promise<{ pinned: ForgePinnedItem }>;
  removeForgePinned(payload: { pinId: string }): Promise<{ ok: boolean }>;
  getForgePinnedStatus(payload: {
    instanceId: string;
    items: { pinId: string; kind: "pr" | "issue"; repo: string; number: number }[];
  }): Promise<{ statuses: ForgePinnedItemStatus[] }>;
  getForgeStarred(payload: { instanceId: string }): Promise<{ repos: string[] }>;
  addForgeStarred(payload: { instanceId: string; repo: string }): Promise<{ ok: boolean }>;
  removeForgeStarred(payload: { instanceId: string; repo: string }): Promise<{ ok: boolean }>;
  getForgeSavedSearches(payload: { instanceId: string }): Promise<{ searches: ForgeSavedSearch[] }>;
  addForgeSavedSearch(payload: {
    instanceId: string;
    name: string;
    kind: "pr" | "issue";
    query: string;
  }): Promise<{ saved: ForgeSavedSearch }>;
  removeForgeSavedSearch(payload: { searchId: string }): Promise<{ ok: boolean }>;
  getForgeSavedSearchResults(payload: {
    instanceId: string;
    searchId: string;
    cursor?: string;
  }): Promise<Paged<ForgePullRequest | ForgeIssue>>;
  refreshForgeCache(payload: { instanceId: string }): Promise<{ ok: boolean }>;
  // Home Assistant
  getHomeAssistantInstances(): Promise<{ instances: HomeAssistantInstance[] }>;
  addHomeAssistantInstance(payload: {
    url: string;
    token: string;
    name?: string;
  }): Promise<{ instance: HomeAssistantInstance }>;
  updateHomeAssistantInstance(payload: {
    id: string;
    url?: string;
    token?: string;
    name?: string;
  }): Promise<{ instance: HomeAssistantInstance }>;
  removeHomeAssistantInstance(payload: { id: string }): Promise<{ ok: boolean }>;
  testHomeAssistantConnection(payload: { instanceId: string }): Promise<{ ok: boolean }>;
  getHomeAssistantDashboards(payload: {
    instanceId: string;
  }): Promise<{ dashboards: HomeAssistantDashboardSummary[] }>;
  getHomeAssistantDashboard(payload: {
    instanceId: string;
    dashboardId: string;
  }): Promise<HomeAssistantDashboardEntitySummary>;
  getHomeAssistantAreas(payload: {
    instanceId: string;
  }): Promise<{ areas: HomeAssistantAreaSummary[] }>;
  getHomeAssistantDevices(payload: {
    instanceId: string;
  }): Promise<{ devices: HomeAssistantDeviceSummary[] }>;
  getHomeAssistantEntities(payload: {
    instanceId: string;
  }): Promise<{ entities: HomeAssistantEntitySummary[] }>;
  getHomeAssistantEntity(payload: {
    instanceId: string;
    entityId: string;
  }): Promise<{ entity: HomeAssistantEntitySummary | null }>;
  getHomeAssistantEntityHistory(payload: {
    instanceId: string;
    entityId: string;
    start: string;
    end: string;
  }): Promise<HomeAssistantEntityHistoryResult>;
  getHomeAssistantState(payload: { instanceId: string }): Promise<{ states: HomeAssistantState[] }>;
  controlHomeAssistantEntity(payload: {
    instanceId: string;
    request: HomeAssistantControlRequest;
  }): Promise<HomeAssistantControlResult>;
  resolveHomeAssistantCameraSnapshotUrl(payload: {
    instanceId: string;
    entityId: string;
  }): Promise<string>;
  subscribeHomeAssistantEvents(
    payload: { instanceId: string },
    onEvent: (event: HomeAssistantLiveEvent) => void,
  ): Promise<() => void>;
  unsubscribeHomeAssistantEvents(payload: { subscriptionId: string }): Promise<{ ok: boolean }>;
  // Jira
  getJiraInstances(): Promise<{ instances: JiraInstance[] }>;
  addJiraInstance(payload: {
    baseUrl: string;
    email: string;
    token: string;
    type: JiraInstanceType;
    name?: string;
  }): Promise<{ instance: JiraInstance }>;
  updateJiraInstance(payload: {
    id: string;
    name?: string;
    baseUrl?: string;
    email?: string;
    token?: string;
    type?: JiraInstanceType;
  }): Promise<{ instance: JiraInstance }>;
  removeJiraInstance(payload: { id: string }): Promise<{ ok: boolean }>;
  testJiraConnection(payload: { instanceId: string }): Promise<{ ok: boolean }>;
  getJiraProjects(payload: { instanceId: string }): Promise<JiraProjectsResponse>;
  getJiraIssues(payload: {
    instanceId: string;
    projectKey?: string;
    jql?: string;
    assignee?: string;
    watcher?: string;
    nextPageToken?: string;
    maxResults?: number;
  }): Promise<JiraIssuesResponse>;
  getJiraIssue(payload: {
    instanceId: string;
    issueKey: string;
  }): Promise<{ issue: JiraIssue; comments: JiraComment[] }>;
  updateJiraIssue(payload: {
    instanceId: string;
    issueKey: string;
    fields: {
      summary?: string;
      description?: string;
      assigneeId?: string;
      priorityId?: string;
      labels?: string[];
      customFields?: Record<string, unknown>;
    };
  }): Promise<void>;
  getJiraTransitions(payload: {
    instanceId: string;
    issueKey: string;
  }): Promise<{ transitions: JiraTransition[] }>;
  transitionJiraIssue(payload: {
    instanceId: string;
    issueKey: string;
    transitionId: string;
    fields?: Record<string, unknown>;
  }): Promise<void>;
  addJiraComment(payload: {
    instanceId: string;
    issueKey: string;
    body: string;
  }): Promise<JiraComment>;
  searchJiraUsers(payload: { instanceId: string; query: string }): Promise<{ users: JiraUser[] }>;
  getJiraPriorities(payload: { instanceId: string }): Promise<{ priorities: JiraPriority[] }>;
  getJiraIssueTypes(payload: {
    instanceId: string;
    projectKey: string;
  }): Promise<{ issueTypes: JiraIssueType[] }>;
  createJiraIssue(payload: {
    instanceId: string;
    fields: {
      projectKey: string;
      issueTypeId: string;
      summary: string;
      description?: string;
      assigneeId?: string;
      priorityId?: string;
      labels?: string[];
      customFields?: Record<string, unknown>;
    };
  }): Promise<{ issue: JiraIssue }>;
  getJiraLabels(payload: { instanceId: string }): Promise<{ labels: string[] }>;
  getJiraCreateFieldsMeta(payload: {
    instanceId: string;
    projectKey: string;
    issueTypeId: string;
  }): Promise<{ fields: JiraFieldMeta[] }>;
  getJiraBoards(payload: {
    instanceId: string;
    projectKey?: string;
  }): Promise<{ boards: JiraBoard[] }>;
  getJiraBoardConfig(payload: {
    instanceId: string;
    boardId: number;
  }): Promise<{ columns: JiraBoardColumn[] }>;
  getJiraSprints(payload: {
    instanceId: string;
    boardId: number;
  }): Promise<{ sprints: JiraSprint[] }>;
  getJiraSprintIssues(payload: {
    instanceId: string;
    sprintId: number;
  }): Promise<JiraIssuesResponse>;
  getJiraBoardIssues(payload: { instanceId: string; boardId: number }): Promise<JiraIssuesResponse>;
  getJiraSavedQueries(): Promise<{ queries: SavedJqlQuery[] }>;
  addJiraSavedQuery(payload: {
    name: string;
    jql: string;
    instanceId: string;
  }): Promise<{ query: SavedJqlQuery }>;
  updateJiraSavedQuery(payload: {
    id: string;
    name?: string;
    jql?: string;
  }): Promise<{ query: SavedJqlQuery }>;
  removeJiraSavedQuery(payload: { id: string }): Promise<{ ok: boolean }>;
  // Diagrams
  listDiagrams(): Promise<DiagramSummary[]>;
  getDiagram(id: string): Promise<DiagramRecord>;
  createDiagram(title?: string): Promise<DiagramRecord>;
  updateDiagram(payload: {
    id: string;
    title?: string;
    scene?: DiagramScene;
  }): Promise<DiagramRecord>;
  deleteDiagram(id: string): Promise<void>;
  // MCP
  getMcpServers(): Promise<import("./mcp-api").McpServerPublic[]>;
  putMcpServers(
    servers: import("./mcp-api").McpServerSaveInput[],
  ): Promise<import("./mcp-api").McpServerPublic[]>;
  testMcpServer(server: import("./mcp-api").McpServerSaveInput): Promise<
    | {
        ok: true;
        status: import("./mcp-api").McpServerStatus;
        tools: import("./mcp-api").McpToolDescriptor[];
      }
    | { ok: false; status: import("./mcp-api").McpServerStatus }
  >;
  listMcpServerTools(serverId: string): Promise<import("./mcp-api").McpToolDescriptor[]>;
  getMcpStatus(): Promise<import("./mcp-api").McpServerStatusPublic[]>;
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
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    photoUrl?: string;
  }>;
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
  async subscribeAppLog(onEvent) {
    onEvent({
      type: "initial",
      chunk: `${JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        scope: "preview",
        message: "Desktop logs are available in the Electron app.",
      })}\n`,
      path: "browser-preview",
    });
    return {
      subscriptionId: "browser-preview",
      path: "browser-preview",
      async unsubscribe() {
        return { ok: true };
      },
    };
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
  async triggerPendingEmbedding() {
    return { documentsQueued: 0 };
  },
  async getEmbedStatus() {
    return { total: 0, embedded: 0, remaining: 0, jobActive: false };
  },
  async getNoteGraph() {
    return { nodes: [], edges: [] };
  },
  async deleteNoteGraphEdges() {
    return { ok: true };
  },
  async enqueueNoteGraphRebuild() {
    return { ok: true, enqueued: false };
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
  async searchCalendarAttendees() {
    return { attendees: [] };
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
        attendees: [],
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
        attendees: [],
      },
    };
  },
  async deleteCalendarEvent() {
    return;
  },
  async rsvpCalendarEvent() {
    return;
  },
  async flushContactCache() {},
  // LinkWarden stubs
  async getLinkwardenInstances() {
    return { instances: [] };
  },
  async addLinkwardenInstance() {
    return {
      instance: { id: "", url: "", name: "" } as LinkwardenInstance,
    };
  },
  async removeLinkwardenInstance() {
    return { ok: false };
  },
  async getLinkwardenLinks() {
    return { response: [] } as LinkwardenLinksResponse;
  },
  async getLinkwardenCollections() {
    return { response: [] } as LinkwardenCollectionsResponse;
  },
  async getLinkwardenTags() {
    return { response: [] } as LinkwardenTagsResponse;
  },
  async getLinkwardenDashboard() {
    return {};
  },
  async createLinkwardenLink() {
    return null;
  },
  async resolveLinkwardenPreviewUrl() {
    return "";
  },
  // Forge stubs
  async getForgeInstances() {
    return { instances: [] as ForgeInstance[] };
  },
  async addForgeInstance() {
    return {
      instance: {
        id: "",
        name: "",
        provider: "github" as const,
        baseUrl: "",
      },
    };
  },
  async updateForgeInstance() {
    return {
      instance: {
        id: "",
        name: "",
        provider: "github" as const,
        baseUrl: "",
      },
    };
  },
  async removeForgeInstance() {
    return { ok: true };
  },
  async getForgeCounts() {
    return { myPRs: 0, reviewing: 0, notifications: 0, assignedIssues: 0 };
  },
  async getForgeList() {
    return { items: [], nextCursor: null };
  },
  async getForgeRepoPRs() {
    return { items: [], nextCursor: null };
  },
  async getForgeRepoIssues() {
    return { items: [], nextCursor: null };
  },
  async getForgePinned() {
    return { items: [] };
  },
  async addForgePinned() {
    return {
      pinned: {
        id: "",
        instanceId: "",
        kind: "pr" as const,
        repo: "",
        number: 0,
        title: "",
        webUrl: "",
        pinnedAt: "",
      },
    };
  },
  async removeForgePinned() {
    return { ok: true };
  },
  async getForgePinnedStatus() {
    return { statuses: [] };
  },
  async getForgeStarred() {
    return { repos: [] };
  },
  async addForgeStarred() {
    return { ok: true };
  },
  async removeForgeStarred() {
    return { ok: true };
  },
  async getForgeSavedSearches() {
    return { searches: [] };
  },
  async addForgeSavedSearch() {
    return {
      saved: {
        id: "",
        instanceId: "",
        name: "",
        kind: "pr" as const,
        query: "",
      },
    };
  },
  async removeForgeSavedSearch() {
    return { ok: true };
  },
  async getForgeSavedSearchResults() {
    return { items: [], nextCursor: null };
  },
  async refreshForgeCache() {
    return { ok: true };
  },
  // Home Assistant stubs
  async getHomeAssistantInstances() {
    return { instances: [] };
  },
  async addHomeAssistantInstance() {
    return {
      instance: { id: "", name: "", url: "" },
    };
  },
  async updateHomeAssistantInstance() {
    return {
      instance: { id: "", name: "", url: "" },
    };
  },
  async removeHomeAssistantInstance() {
    return { ok: false };
  },
  async testHomeAssistantConnection() {
    return { ok: false };
  },
  async getHomeAssistantDashboards() {
    return { dashboards: [] };
  },
  async getHomeAssistantDashboard() {
    return { dashboard: { id: "", title: "", path: "" }, entities: [] };
  },
  async getHomeAssistantAreas() {
    return { areas: [] };
  },
  async getHomeAssistantDevices() {
    return { devices: [] };
  },
  async getHomeAssistantEntities() {
    return { entities: [] };
  },
  async getHomeAssistantEntity() {
    return { entity: null };
  },
  async getHomeAssistantEntityHistory() {
    return { entries: [] };
  },
  async getHomeAssistantState() {
    return { states: [] };
  },
  async controlHomeAssistantEntity() {
    return { ok: false };
  },
  async resolveHomeAssistantCameraSnapshotUrl() {
    return "";
  },
  async subscribeHomeAssistantEvents() {
    return () => {};
  },
  async unsubscribeHomeAssistantEvents() {
    return { ok: true };
  },
  // Jira stubs
  async getJiraInstances() {
    return { instances: [] };
  },
  async addJiraInstance() {
    return { instance: { id: "", name: "", baseUrl: "", email: "", type: "cloud" as const } };
  },
  async updateJiraInstance() {
    return { instance: { id: "", name: "", baseUrl: "", email: "", type: "cloud" as const } };
  },
  async removeJiraInstance() {
    return { ok: false };
  },
  async testJiraConnection() {
    return { ok: false };
  },
  async getJiraProjects() {
    return { projects: [] };
  },
  async getJiraIssues() {
    return { issues: [], total: 0, nextPageToken: null };
  },
  async getJiraIssue() {
    return { issue: {} as JiraIssue, comments: [] };
  },
  async updateJiraIssue() {
    return;
  },
  async getJiraTransitions() {
    return { transitions: [] };
  },
  async transitionJiraIssue() {
    return;
  },
  async addJiraComment() {
    return { id: "", author: null, body: "", bodyHtml: null, created: "", updated: "" };
  },
  async searchJiraUsers() {
    return { users: [] };
  },
  async getJiraPriorities() {
    return { priorities: [] };
  },
  async getJiraIssueTypes() {
    return { issueTypes: [] };
  },
  async createJiraIssue() {
    return { issue: {} as JiraIssue };
  },
  async getJiraLabels() {
    return { labels: [] };
  },
  async getJiraCreateFieldsMeta() {
    return { fields: [] };
  },
  async getJiraBoards() {
    return { boards: [] };
  },
  async getJiraBoardConfig() {
    return { columns: [] };
  },
  async getJiraSprints() {
    return { sprints: [] };
  },
  async getJiraSprintIssues() {
    return { issues: [], total: 0, nextPageToken: null };
  },
  async getJiraBoardIssues() {
    return { issues: [], total: 0, nextPageToken: null };
  },
  async getJiraSavedQueries() {
    return { queries: [] };
  },
  async addJiraSavedQuery() {
    return { query: { id: "", name: "", jql: "", instanceId: "" } };
  },
  async updateJiraSavedQuery() {
    return { query: { id: "", name: "", jql: "", instanceId: "" } };
  },
  async removeJiraSavedQuery() {
    return { ok: false };
  },
  // Diagrams stubs
  async listDiagrams() {
    return [];
  },
  async getDiagram(id: string) {
    const now = new Date().toISOString();
    return {
      id,
      title: "Untitled diagram",
      createdAt: now,
      updatedAt: now,
      scene: { elements: [], appState: {}, files: {} },
    };
  },
  async createDiagram(title?: string) {
    const now = new Date().toISOString();
    return {
      id: "browser-diagram",
      title: title ?? "Untitled diagram",
      createdAt: now,
      updatedAt: now,
      scene: { elements: [], appState: {}, files: {} },
    };
  },
  async updateDiagram(payload) {
    const now = new Date().toISOString();
    return {
      id: payload.id,
      title: payload.title ?? "Untitled diagram",
      createdAt: now,
      updatedAt: now,
      scene: payload.scene ?? { elements: [], appState: {}, files: {} },
    };
  },
  async deleteDiagram() {
    return;
  },
  // MCP stubs
  async getMcpServers() {
    return [];
  },
  async putMcpServers() {
    return [];
  },
  async testMcpServer() {
    return {
      ok: false as const,
      status: {
        kind: "unreachable" as const,
        error: "browser stub",
        checkedAt: new Date().toISOString(),
      },
    };
  },
  async listMcpServerTools() {
    return [];
  },
  async getMcpStatus() {
    return [];
  },
};

export function desktopApi(): DesktopApi {
  return (window as Window & { slateDesktop?: DesktopApi }).slateDesktop ?? browserFallback;
}
