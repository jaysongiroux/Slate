import { desktopApi } from "./ipc-core";
import type { ForgePrSearchState } from "@slate/shared";

export function getForgeInstances() {
  return desktopApi().getForgeInstances();
}
export function addForgeInstance(payload: {
  provider: "github" | "gitlab";
  baseUrl: string;
  token: string;
  name?: string;
}) {
  return desktopApi().addForgeInstance(payload);
}
export function updateForgeInstance(payload: {
  id: string;
  name?: string;
  baseUrl?: string;
  provider?: "github" | "gitlab";
  token?: string;
}) {
  return desktopApi().updateForgeInstance(payload);
}
export function removeForgeInstance(payload: { id: string }) {
  return desktopApi().removeForgeInstance(payload);
}
export function getForgeCounts(payload: { instanceId: string }) {
  return desktopApi().getForgeCounts(payload);
}
export function getForgeList(payload: {
  instanceId: string;
  kind: "my-prs" | "reviewing" | "notifications" | "assigned-issues" | "repos";
  cursor?: string;
}) {
  return desktopApi().getForgeList(payload);
}
export function getForgeRepoPRs(payload: {
  instanceId: string;
  repo: string;
  cursor?: string;
  query?: string;
}) {
  return desktopApi().getForgeRepoPRs(payload);
}
export function searchForgePRs(payload: {
  instanceId: string;
  query: string;
  state: ForgePrSearchState;
  cursor?: string;
}) {
  return desktopApi().searchForgePRs(payload);
}
export function getForgeRepoIssues(payload: { instanceId: string; repo: string; cursor?: string }) {
  return desktopApi().getForgeRepoIssues(payload);
}
export function getForgePinned(payload: { instanceId: string }) {
  return desktopApi().getForgePinned(payload);
}
export function addForgePinned(payload: {
  instanceId: string;
  kind: "pr" | "issue";
  repo: string;
  number: number;
}) {
  return desktopApi().addForgePinned(payload);
}
export function removeForgePinned(payload: { pinId: string }) {
  return desktopApi().removeForgePinned(payload);
}
export function getForgePinnedStatus(payload: {
  instanceId: string;
  items: { pinId: string; kind: "pr" | "issue"; repo: string; number: number }[];
}) {
  return desktopApi().getForgePinnedStatus(payload);
}
export function getForgeStarred(payload: { instanceId: string }) {
  return desktopApi().getForgeStarred(payload);
}
export function addForgeStarred(payload: { instanceId: string; repo: string }) {
  return desktopApi().addForgeStarred(payload);
}
export function removeForgeStarred(payload: { instanceId: string; repo: string }) {
  return desktopApi().removeForgeStarred(payload);
}
export function getForgeSavedSearches(payload: { instanceId: string }) {
  return desktopApi().getForgeSavedSearches(payload);
}
export function addForgeSavedSearch(payload: {
  instanceId: string;
  name: string;
  kind: "pr" | "issue";
  query: string;
}) {
  return desktopApi().addForgeSavedSearch(payload);
}
export function removeForgeSavedSearch(payload: { searchId: string }) {
  return desktopApi().removeForgeSavedSearch(payload);
}
export function getForgeSavedSearchResults(payload: {
  instanceId: string;
  searchId: string;
  cursor?: string;
}) {
  return desktopApi().getForgeSavedSearchResults(payload);
}
export function refreshForgeCache(payload: { instanceId: string }) {
  return desktopApi().refreshForgeCache(payload);
}
