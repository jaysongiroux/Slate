export type SyncState = "offline" | "idle" | "pending" | "error";

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
  connected: boolean;
  linkedUserId?: string;
  linkedWorkspaceId?: string;
}

export interface DesktopSnapshot {
  workspace: LocalWorkspaceProfile;
  backend: BackendConnectionConfig;
  notes: LocalNoteSummary[];
}

export interface SearchIndexJobPayload {
  workspaceId: string;
  documentId: string;
}
