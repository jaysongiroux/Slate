import { create } from "zustand";

export type HomeAssistantBrowseMode = "dashboards" | "areas" | "devices" | "entities" | "scenes";

interface HomeAssistantState {
  selectedInstanceId: string | null;
  setSelectedInstanceId: (id: string | null) => void;
  selectedDashboardId: string | null;
  setSelectedDashboardId: (id: string | null) => void;
  selectedBrowseMode: HomeAssistantBrowseMode;
  setSelectedBrowseMode: (mode: HomeAssistantBrowseMode) => void;
  selectedAreaId: string | null;
  setSelectedAreaId: (id: string | null) => void;
  selectedDeviceId: string | null;
  setSelectedDeviceId: (id: string | null) => void;
  refreshSignal: number;
  setRefreshSignal: (updater: number | ((current: number) => number)) => void;
  refresh: () => void;
  resetNavigation: () => void;
}

export const useHomeAssistantStore = create<HomeAssistantState>((set) => ({
  selectedInstanceId: null,
  setSelectedInstanceId: (selectedInstanceId) =>
    set({
      selectedInstanceId,
      selectedDashboardId: null,
      selectedBrowseMode: "dashboards",
      selectedAreaId: null,
      selectedDeviceId: null,
    }),
  selectedDashboardId: null,
  setSelectedDashboardId: (selectedDashboardId) =>
    set({
      selectedDashboardId,
      selectedBrowseMode: "dashboards",
      selectedAreaId: null,
      selectedDeviceId: null,
    }),
  selectedBrowseMode: "dashboards",
  setSelectedBrowseMode: (selectedBrowseMode) =>
    set({
      selectedBrowseMode,
      selectedAreaId: null,
      selectedDeviceId: null,
    }),
  selectedAreaId: null,
  setSelectedAreaId: (selectedAreaId) => set({ selectedAreaId, selectedDeviceId: null }),
  selectedDeviceId: null,
  setSelectedDeviceId: (selectedDeviceId) => set({ selectedDeviceId }),
  refreshSignal: 0,
  setRefreshSignal: (updater) =>
    set((state) => ({
      refreshSignal: typeof updater === "function" ? updater(state.refreshSignal) : updater,
    })),
  refresh: () => set((state) => ({ refreshSignal: state.refreshSignal + 1 })),
  resetNavigation: () =>
    set({
      selectedInstanceId: null,
      selectedDashboardId: null,
      selectedBrowseMode: "dashboards",
      selectedAreaId: null,
      selectedDeviceId: null,
    }),
}));
