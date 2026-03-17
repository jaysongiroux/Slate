export type SyncState = "offline" | "idle" | "pending" | "error";
export type BackendAuthStatus = "signed_out" | "authenticating" | "authenticated" | "error";

export interface BackendAuthProvider {
  id: string;
  label: string;
  type: string;
  accountCreationEnabled?: boolean;
}

export interface LocalWorkspaceProfile {
  id: string;
  name: string;
  rootPath: string;
  linkedWorkspaceId?: string;
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
  authenticatedWorkspaceId?: string;
  authenticatedEmail?: string;
  authenticatedDisplayName?: string;
  authenticatedWorkspaceName?: string;
  authenticatedIsAdmin?: boolean;
  tokenExpiresAtUnix?: number;
}

export interface DesktopSnapshot {
  workspace: LocalWorkspaceProfile;
  backend: BackendConnectionConfig;
  notes: LocalNoteSummary[];
  folders: string[];
}

export interface SearchIndexJobPayload {
  workspaceId: string;
  documentId: string;
}
