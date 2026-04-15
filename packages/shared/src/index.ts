export { slateSchema } from "./schema";
export { slateMarkdownSerializer } from "./markdown-serializer";
export { slateMarkdownParser } from "./markdown-parser";
export { parseMarkdownForTiptapPaste } from "./markdown-paste";
export { normalizeProsemirrorJsonForSlateSchema } from "./prosemirror-normalize";
export { tiptapSchema, toTiptapJson } from "./tiptap-ydoc";
export { tiptapDocJsonToSlateDocJson } from "./tiptap-to-slate-json";
export { expandTableOfContentsInDocJson } from "./export-expand-toc";
export { noteContentToMarkdown } from "./export-note-markdown";
export { inlineAttachmentImagesInMarkdown } from "./export-inline-images";
export { sanitizeZipEntryPath } from "./export-zip-path";
export { deriveDocumentTitle } from "./note-title";
export {
  CHAT_MODEL_PRESETS,
  EMBEDDING_MODEL_PRESETS,
  getEmbeddingNativeDimensionsHint,
} from "./ai-presets";
export {
  NOTE_GRAPH_ENABLED_SETTING_KEY,
  CHECKLISTS_ENABLED_SETTING_KEY,
  CHECKLISTS_SETTING_KEY,
  CHECKLISTS_SELECTED_KEY,
} from "./extension-settings";

export type SyncState = "offline" | "idle" | "pending" | "error";
export type BackendAuthStatus = "signed_out" | "authenticating" | "authenticated" | "error";

export interface BackendAuthProvider {
  id: string;
  label: string;
  type: string;
  accountCreationEnabled?: boolean;
}

export interface LocalLibraryProfile {
  id: string;
  name: string;
  rootPath: string;
  linkedUserId?: string;
  backendEndpoint?: string;
  connected?: boolean;
}

export interface LocalDocumentRecord {
  id: string;
  title: string;
  path: string;
  content: Record<string, unknown>;
  updatedAt: string;
  deleted: boolean;
}

export interface LocalNoteSummary {
  id: string;
  title: string;
  path: string;
  pinned: boolean;
  isTemplate: boolean;
  deleted: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface BackendConnectionConfig {
  endpoint: string;
  clientId: string;
  backendReachable: boolean;
  authStatus: BackendAuthStatus;
  authProviders: BackendAuthProvider[];
  authenticatedUserId?: string;
  authenticatedEmail?: string;
  authenticatedDisplayName?: string;
  authenticatedIsAdmin?: boolean;
  tokenExpiresAtUnix?: number;
}

export interface DesktopSnapshot {
  backend: BackendConnectionConfig;
  notes: LocalNoteSummary[];
  folders: string[];
}

export interface SearchIndexJobPayload {
  userId: string;
  documentId: string;
}

export interface CalendarInfo {
  subscriptionId: string;
  calendarId: string;
  name: string;
  color: string;
  enabled: boolean;
  provider?: string;
}

export interface CalendarConnectionInfo {
  id: string;
  provider: string;
  email: string;
  calendars: CalendarInfo[];
}

export interface IcsSubscriptionInfo {
  id: string;
  url: string;
  name: string;
  color: string;
  enabled: boolean;
}

export interface CalendarProviderInfo {
  providerId: string;
  label: string;
  configured: boolean;
}

export interface CalendarStatusResponse {
  providers: CalendarProviderInfo[];
  connections: CalendarConnectionInfo[];
  icsSubscriptions: IcsSubscriptionInfo[];
}

export interface AvailableCalendar {
  calendarId: string;
  name: string;
  color: string;
  isPrimary: boolean;
}

export interface CalendarEventAttachment {
  fileUrl: string;
  title: string;
  mimeType?: string;
  iconLink?: string;
}

export interface CalendarEvent {
  id: string;
  subscriptionId?: string;
  calendarId: string;
  calendarName?: string;
  source: "google" | "ics" | string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  color: string;
  htmlLink?: string;
  readOnly: boolean;
  conferenceLink?: string;
  conferenceName?: string;
  attachments?: CalendarEventAttachment[];
  attendees?: CalendarEventAttendee[];
}

export interface CalendarEventAttendee {
  email: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
  photoUrl?: string;
}

export interface CalendarAttendeeInput {
  email: string;
  displayName?: string;
  photoUrl?: string;
}

export interface CalendarAttendeeSuggestion extends CalendarAttendeeInput {
  personId?: string;
  source: "contacts" | "otherContacts" | "directory";
}
