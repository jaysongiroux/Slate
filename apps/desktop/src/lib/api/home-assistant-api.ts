import type {
  HomeAssistantControlRequest,
  HomeAssistantEntityHistoryResult,
  HomeAssistantLiveEvent,
} from "@slate/shared";
import { desktopApi } from "./ipc-core";

export function getHomeAssistantInstances() {
  return desktopApi().getHomeAssistantInstances();
}

export function addHomeAssistantInstance(payload: { url: string; token: string; name?: string }) {
  return desktopApi().addHomeAssistantInstance(payload);
}

export function updateHomeAssistantInstance(payload: {
  id: string;
  url?: string;
  token?: string;
  name?: string;
}) {
  return desktopApi().updateHomeAssistantInstance(payload);
}

export function removeHomeAssistantInstance(payload: { id: string }) {
  return desktopApi().removeHomeAssistantInstance(payload);
}

export function testHomeAssistantConnection(payload: { instanceId: string }) {
  return desktopApi().testHomeAssistantConnection(payload);
}

export function getHomeAssistantDashboards(payload: { instanceId: string }) {
  return desktopApi().getHomeAssistantDashboards(payload);
}

export function getHomeAssistantDashboard(payload: { instanceId: string; dashboardId: string }) {
  return desktopApi().getHomeAssistantDashboard(payload);
}

export function getHomeAssistantAreas(payload: { instanceId: string }) {
  return desktopApi().getHomeAssistantAreas(payload);
}

export function getHomeAssistantDevices(payload: { instanceId: string }) {
  return desktopApi().getHomeAssistantDevices(payload);
}

export function getHomeAssistantEntities(payload: { instanceId: string }) {
  return desktopApi().getHomeAssistantEntities(payload);
}

export function getHomeAssistantEntity(payload: { instanceId: string; entityId: string }) {
  return desktopApi().getHomeAssistantEntity(payload);
}

export function getHomeAssistantEntityHistory(payload: {
  instanceId: string;
  entityId: string;
  start: string;
  end: string;
}): Promise<HomeAssistantEntityHistoryResult> {
  return desktopApi().getHomeAssistantEntityHistory(payload);
}

export function getHomeAssistantState(payload: { instanceId: string }) {
  return desktopApi().getHomeAssistantState(payload);
}

export function controlHomeAssistantEntity(payload: {
  instanceId: string;
  request: HomeAssistantControlRequest;
}) {
  return desktopApi().controlHomeAssistantEntity(payload);
}

export function resolveHomeAssistantCameraSnapshotUrl(payload: {
  instanceId: string;
  entityId: string;
}) {
  return desktopApi().resolveHomeAssistantCameraSnapshotUrl(payload);
}

export function subscribeHomeAssistantEvents(
  payload: { instanceId: string },
  onEvent: (event: HomeAssistantLiveEvent) => void,
) {
  return desktopApi().subscribeHomeAssistantEvents(payload, onEvent);
}
