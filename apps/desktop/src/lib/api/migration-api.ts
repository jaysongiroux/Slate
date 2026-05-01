import type { NoteDocType } from "../../db/schemas/note.schema";
import type { FolderDocType } from "../../db/schemas/folder.schema";
import type { SettingDocType } from "../../db/schemas/setting.schema";

export interface MigrationAttachmentMeta {
  id: string;
  containerType: "note" | "diagram";
  containerId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface MigrationDiagram {
  id: string;
  title: string;
  scene: unknown;
  createdAt: string;
  updatedAt: string;
}

function joinUrl(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, "")}${path}`;
}

async function jsonOrThrow(method: string, url: string, response: Response) {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${method} ${url} failed (${response.status}): ${text || response.statusText}`);
  }
  return await response.json();
}

export interface IdConflictReport {
  folders: string[];
  notes: string[];
  diagrams: string[];
  attachments: string[];
  settings: string[];
}

export async function checkIdConflicts(
  endpoint: string,
  accessToken: string,
  payload: {
    folders: string[];
    notes: string[];
    diagrams: string[];
    attachments: string[];
    settings: string[];
  },
): Promise<IdConflictReport> {
  const url = joinUrl(endpoint, "/api/replication/check-id-conflicts");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  return (await jsonOrThrow("POST", url, res)) as IdConflictReport;
}

export async function listAttachments(
  endpoint: string,
  accessToken: string,
): Promise<MigrationAttachmentMeta[]> {
  const url = joinUrl(endpoint, "/api/attachments/list");
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await jsonOrThrow("GET", url, res);
  return body.attachments as MigrationAttachmentMeta[];
}

export async function downloadAttachment(
  endpoint: string,
  accessToken: string,
  attachmentId: string,
): Promise<Blob> {
  const url = joinUrl(
    endpoint,
    `/api/attachments/${encodeURIComponent(attachmentId)}/content?token=${encodeURIComponent(accessToken)}`,
  );
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download attachment ${attachmentId} failed (${res.status})`);
  }
  return await res.blob();
}

export async function listDiagrams(
  endpoint: string,
  accessToken: string,
): Promise<Array<{ id: string }>> {
  const url = joinUrl(endpoint, "/api/diagrams");
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const list = await jsonOrThrow("GET", url, res);
  return list as Array<{ id: string }>;
}

export async function getDiagram(
  endpoint: string,
  accessToken: string,
  id: string,
): Promise<MigrationDiagram> {
  const url = joinUrl(endpoint, `/api/diagrams/${encodeURIComponent(id)}`);
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return (await jsonOrThrow("GET", url, res)) as MigrationDiagram;
}

export async function bulkImportNotes(
  endpoint: string,
  accessToken: string,
  documents: NoteDocType[],
): Promise<{ imported: number; skipped: number }> {
  const url = joinUrl(endpoint, "/api/replication/notes/bulk-import");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ documents }),
  });
  return (await jsonOrThrow("POST", url, res)) as { imported: number; skipped: number };
}

export async function bulkImportFolders(
  endpoint: string,
  accessToken: string,
  documents: FolderDocType[],
): Promise<{ imported: number; skipped: number }> {
  const url = joinUrl(endpoint, "/api/replication/folders/bulk-import");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ documents }),
  });
  return (await jsonOrThrow("POST", url, res)) as { imported: number; skipped: number };
}

export async function bulkImportSettings(
  endpoint: string,
  accessToken: string,
  documents: SettingDocType[],
): Promise<{ imported: number; rejected: number }> {
  const url = joinUrl(endpoint, "/api/replication/settings/bulk-import");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ documents }),
  });
  return (await jsonOrThrow("POST", url, res)) as { imported: number; rejected: number };
}

export async function bulkImportDiagrams(
  endpoint: string,
  accessToken: string,
  diagrams: MigrationDiagram[],
): Promise<{ imported: number; skipped: number }> {
  const url = joinUrl(endpoint, "/api/diagrams/bulk-import");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ diagrams }),
  });
  return (await jsonOrThrow("POST", url, res)) as { imported: number; skipped: number };
}

export type BulkImportAttachmentResult =
  | { kind: "imported"; id: string }
  | { kind: "skipped-cross-user"; id: string };

export async function bulkImportAttachment(
  endpoint: string,
  accessToken: string,
  payload: {
    id: string;
    blob: Blob;
    containerType: "note" | "diagram";
    containerId: string;
    originalName: string;
    mimeType: string;
  },
): Promise<BulkImportAttachmentResult> {
  const url = joinUrl(endpoint, "/api/attachments/bulk-import");
  const form = new FormData();
  form.append("file", payload.blob, payload.originalName);
  form.append("id", payload.id);
  form.append("containerType", payload.containerType);
  form.append("containerId", payload.containerId);
  form.append("originalName", payload.originalName);
  form.append("mimeType", payload.mimeType);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  // Cross-user id collision (e.g. leftover row from a previous migration
  // attempt under a different login) — treat as a soft skip so the rest of
  // the migration can finish. The caller decides how to surface the count.
  if (res.status === 409) {
    return { kind: "skipped-cross-user", id: payload.id };
  }
  const body = (await jsonOrThrow("POST", url, res)) as { id: string };
  return { kind: "imported", id: body.id };
}
