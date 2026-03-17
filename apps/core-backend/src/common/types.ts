export interface SessionPrincipal {
  userId: string;
  workspaceId: string;
}

export interface DocumentUpsertInput {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  title: string;
  path: string;
  markdown: string;
  plainText: string;
  deleted: boolean;
  acceptedRevision: bigint;
}

