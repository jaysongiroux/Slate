import type { JiraInstanceType } from "@slate/shared";
import { desktopApi } from "./ipc-core";

export function getJiraInstances() {
  return desktopApi().getJiraInstances();
}

export function addJiraInstance(payload: {
  baseUrl: string;
  email: string;
  token: string;
  type: JiraInstanceType;
  name?: string;
}) {
  return desktopApi().addJiraInstance(payload);
}

export function updateJiraInstance(payload: {
  id: string;
  name?: string;
  baseUrl?: string;
  email?: string;
  token?: string;
  type?: JiraInstanceType;
}) {
  return desktopApi().updateJiraInstance(payload);
}

export function removeJiraInstance(payload: { id: string }) {
  return desktopApi().removeJiraInstance(payload);
}

export function testJiraConnection(payload: { instanceId: string }) {
  return desktopApi().testJiraConnection(payload);
}

export function getJiraProjects(payload: { instanceId: string }) {
  return desktopApi().getJiraProjects(payload);
}

export function getJiraIssues(payload: {
  instanceId: string;
  projectKey?: string;
  jql?: string;
  assignee?: string;
  watcher?: string;
  nextPageToken?: string;
  maxResults?: number;
}) {
  return desktopApi().getJiraIssues(payload);
}

export function getJiraIssue(payload: { instanceId: string; issueKey: string }) {
  return desktopApi().getJiraIssue(payload);
}

export function updateJiraIssue(payload: {
  instanceId: string;
  issueKey: string;
  fields: {
    summary?: string;
    description?: string;
    assigneeId?: string;
    priorityId?: string;
    labels?: string[];
    customFields?: Record<string, unknown>;
  };
}) {
  return desktopApi().updateJiraIssue(payload);
}

export function getJiraTransitions(payload: { instanceId: string; issueKey: string }) {
  return desktopApi().getJiraTransitions(payload);
}

export function transitionJiraIssue(payload: {
  instanceId: string;
  issueKey: string;
  transitionId: string;
  fields?: Record<string, unknown>;
}) {
  return desktopApi().transitionJiraIssue(payload);
}

export function addJiraComment(payload: { instanceId: string; issueKey: string; body: string }) {
  return desktopApi().addJiraComment(payload);
}

export function searchJiraUsers(payload: { instanceId: string; query: string }) {
  return desktopApi().searchJiraUsers(payload);
}

export function getJiraPriorities(payload: { instanceId: string }) {
  return desktopApi().getJiraPriorities(payload);
}

export function getJiraIssueTypes(payload: { instanceId: string; projectKey: string }) {
  return desktopApi().getJiraIssueTypes(payload);
}

export function getJiraLabels(payload: { instanceId: string }) {
  return desktopApi().getJiraLabels(payload);
}

export function getJiraCreateFieldsMeta(payload: {
  instanceId: string;
  projectKey: string;
  issueTypeId: string;
}) {
  return desktopApi().getJiraCreateFieldsMeta(payload);
}

export function createJiraIssue(payload: {
  instanceId: string;
  fields: {
    projectKey: string;
    issueTypeId: string;
    summary: string;
    description?: string;
    assigneeId?: string;
    priorityId?: string;
    labels?: string[];
    customFields?: Record<string, unknown>;
  };
}) {
  return desktopApi().createJiraIssue(payload);
}

export function getJiraBoards(payload: { instanceId: string; projectKey?: string }) {
  return desktopApi().getJiraBoards(payload);
}

export function getJiraBoardConfig(payload: { instanceId: string; boardId: number }) {
  return desktopApi().getJiraBoardConfig(payload);
}

export function getJiraSprints(payload: { instanceId: string; boardId: number }) {
  return desktopApi().getJiraSprints(payload);
}

export function getJiraSprintIssues(payload: { instanceId: string; sprintId: number }) {
  return desktopApi().getJiraSprintIssues(payload);
}

export function getJiraBoardIssues(payload: { instanceId: string; boardId: number }) {
  return desktopApi().getJiraBoardIssues(payload);
}
