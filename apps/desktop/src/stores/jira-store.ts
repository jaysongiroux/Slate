import { create } from "zustand";

export type JiraView = "projects" | "issues" | "board" | "issue-detail";

interface JiraState {
  selectedInstanceId: string | null;
  setSelectedInstanceId: (id: string | null) => void;
  selectedProjectKey: string | null;
  selectedProjectName: string | null;
  setSelectedProject: (key: string | null, name?: string | null) => void;
  selectedBoardId: number | null;
  setSelectedBoardId: (id: number | null) => void;
  selectedSprintId: number | null;
  setSelectedSprintId: (id: number | null) => void;
  selectedIssueKey: string | null;
  setSelectedIssueKey: (key: string | null) => void;
  view: JiraView;
  setView: (view: JiraView) => void;
  issueFilters: { jql?: string; assignee?: string; watcher?: string };
  setIssueFilters: (filters: { jql?: string; assignee?: string; watcher?: string }) => void;
  issuesRefreshSignal: number;
  refreshIssues: () => void;
  resetNavigation: () => void;
}

export const useJiraStore = create<JiraState>((set) => ({
  selectedInstanceId: null,
  setSelectedInstanceId: (selectedInstanceId) =>
    set({
      selectedInstanceId,
      selectedProjectKey: null,
      selectedProjectName: null,
      selectedBoardId: null,
      selectedSprintId: null,
      selectedIssueKey: null,
      view: "projects",
      issueFilters: {},
    }),
  selectedProjectKey: null,
  selectedProjectName: null,
  setSelectedProject: (selectedProjectKey, selectedProjectName = null) =>
    set({
      selectedProjectKey,
      selectedProjectName: selectedProjectName ?? null,
      selectedBoardId: null,
      selectedSprintId: null,
      selectedIssueKey: null,
      view: "issues",
    }),
  selectedBoardId: null,
  setSelectedBoardId: (selectedBoardId) =>
    set({ selectedBoardId, selectedSprintId: null, selectedIssueKey: null, view: "board" }),
  selectedSprintId: null,
  setSelectedSprintId: (selectedSprintId) => set({ selectedSprintId, selectedIssueKey: null }),
  selectedIssueKey: null,
  setSelectedIssueKey: (selectedIssueKey) =>
    set({ selectedIssueKey, view: selectedIssueKey ? "issue-detail" : "issues" }),
  view: "projects",
  setView: (view) => set({ view }),
  issueFilters: {},
  setIssueFilters: (issueFilters) => set({ issueFilters, view: "issues" }),
  issuesRefreshSignal: 0,
  refreshIssues: () => set((s) => ({ issuesRefreshSignal: s.issuesRefreshSignal + 1 })),
  resetNavigation: () =>
    set({
      selectedProjectKey: null,
      selectedProjectName: null,
      selectedBoardId: null,
      selectedSprintId: null,
      selectedIssueKey: null,
      view: "projects",
      issueFilters: {},
    }),
}));
