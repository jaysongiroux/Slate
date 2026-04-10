import { desktopApi } from "./ipc-core";

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
