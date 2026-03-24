export { slateSchema } from "./schema";
export { slateMarkdownSerializer } from "./markdown-serializer";
export { slateMarkdownParser } from "./markdown-parser";
export {
  CHAT_MODEL_PRESETS,
  EMBEDDING_MODEL_PRESETS,
  getEmbeddingNativeDimensionsHint,
} from "./ai-presets";

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
  markdown: string;
  plainText: string;
  updatedAt: string;
  acceptedRevision: number;
  deleted: boolean;
}

export interface LocalNoteSummary {
  id: string;
  title: string;
  path: string;
  preview: string;
  markdown: string;
  plainText: string;
  updatedAt: string;
  acceptedRevision: number;
  deleted: boolean;
  syncState: SyncState;
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
  workspace: LocalLibraryProfile;
  backend: BackendConnectionConfig;
  notes: LocalNoteSummary[];
  folders: string[];
}

export interface SearchIndexJobPayload {
  userId: string;
  documentId: string;
}
