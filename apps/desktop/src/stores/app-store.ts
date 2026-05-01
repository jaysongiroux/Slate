import { create } from "zustand";
import type { SidebarMode } from "../components/IconRail";
import type { View as CalendarViewType } from "react-big-calendar";

export type MainPanelMode =
  | "notes"
  | "calendar"
  | "checklists"
  | "linkwarden"
  | "home-assistant"
  | "jira"
  | "forge"
  | "diagrams"
  | "graph";

type AppState = {
  sidebarMode: SidebarMode;
  setSidebarMode: (mode: SidebarMode) => void;
  mainPanelMode: MainPanelMode;
  setMainPanelMode: (mode: MainPanelMode) => void;
  selectedNoteId: string;
  setSelectedNoteId: (id: string) => void;
  selectedDiagramId: string;
  setSelectedDiagramId: (id: string) => void;
  diagramRefreshSignal: number;
  bumpDiagramRefreshSignal: () => void;
  calendarView: CalendarViewType;
  setCalendarView: (v: CalendarViewType) => void;
  calendarDate: Date;
  setCalendarDate: (d: Date) => void;
};

export const useAppStore = create<AppState>((set) => ({
  sidebarMode: "notes",
  setSidebarMode: (sidebarMode) => set({ sidebarMode }),
  mainPanelMode: "notes",
  setMainPanelMode: (mainPanelMode) => set({ mainPanelMode }),
  selectedNoteId: "",
  setSelectedNoteId: (selectedNoteId) => set({ selectedNoteId }),
  selectedDiagramId: "",
  setSelectedDiagramId: (selectedDiagramId) => set({ selectedDiagramId }),
  diagramRefreshSignal: 0,
  bumpDiagramRefreshSignal: () =>
    set((s) => ({ diagramRefreshSignal: s.diagramRefreshSignal + 1 })),
  calendarView: "month",
  setCalendarView: (calendarView) => set({ calendarView }),
  calendarDate: new Date(),
  setCalendarDate: (calendarDate) => set({ calendarDate }),
}));
