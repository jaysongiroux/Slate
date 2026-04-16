import { desktopApi } from "./ipc-core";

export function getLinkwardenInstances() {
  return desktopApi().getLinkwardenInstances();
}

export function addLinkwardenInstance(payload: { url: string; token: string; name?: string }) {
  return desktopApi().addLinkwardenInstance(payload);
}

export function removeLinkwardenInstance(payload: { id: string }) {
  return desktopApi().removeLinkwardenInstance(payload);
}

export function getLinkwardenLinks(payload: {
  instanceId: string;
  collectionId?: number;
  tagId?: number;
  searchQueryString?: string;
  cursor?: number;
  sort?: number;
}) {
  return desktopApi().getLinkwardenLinks(payload);
}

export function getLinkwardenCollections(payload: { instanceId: string }) {
  return desktopApi().getLinkwardenCollections(payload);
}

export function getLinkwardenTags(payload: { instanceId: string }) {
  return desktopApi().getLinkwardenTags(payload);
}

export function getLinkwardenDashboard(payload: { instanceId: string }) {
  return desktopApi().getLinkwardenDashboard(payload);
}

export function createLinkwardenLink(payload: {
  instanceId: string;
  url: string;
  name?: string;
  description?: string;
  collection?: { id: number };
  tags?: string[];
}) {
  return desktopApi().createLinkwardenLink(payload);
}

export function resolveLinkwardenPreviewUrl(payload: { instanceId: string; linkId: number }) {
  return desktopApi().resolveLinkwardenPreviewUrl(payload);
}
