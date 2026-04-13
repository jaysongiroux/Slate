import { desktopApi } from "./ipc-core";

export function setBackendEndpoint(endpoint: string) {
  return desktopApi().setBackendEndpoint(endpoint);
}

export function checkBackendConnection(endpoint: string) {
  return desktopApi().checkBackendConnection(endpoint);
}

export function refreshBackendStatus() {
  return desktopApi().refreshBackendStatus();
}

export function loginWithPassword(payload: { email: string; password: string; totpCode?: string }) {
  return desktopApi().loginWithPassword(payload);
}

export function loginWithOidc(providerId: string) {
  return desktopApi().loginWithOidc(providerId);
}

export function cancelOidc() {
  return desktopApi().cancelOidc();
}

export function signOutBackend() {
  return desktopApi().signOutBackend();
}

export function connectBackend() {
  return desktopApi().connectBackend();
}
