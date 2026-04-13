import { create } from "zustand";
import type { ConnectionStatus } from "../components/SettingsDialog";

export type SaveState = "idle" | "saving" | "saved" | "error";

type SyncState = {
  saveState: SaveState;
  setSaveState: (state: SaveState) => void;
  backendSyncing: boolean;
  setBackendSyncing: (v: boolean) => void;
  backendEndpoint: string;
  setBackendEndpointValue: (v: string) => void;
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (v: ConnectionStatus) => void;
  connectionError: string;
  setConnectionError: (v: string) => void;
  authEmail: string;
  setAuthEmail: (v: string) => void;
  authPassword: string;
  setAuthPassword: (v: string) => void;
  authSubmitting: boolean;
  setAuthSubmitting: (v: boolean) => void;
  authError: string;
  setAuthError: (v: string) => void;
};

export const useSyncStore = create<SyncState>((set) => ({
  saveState: "idle",
  setSaveState: (saveState) => set({ saveState }),
  backendSyncing: false,
  setBackendSyncing: (backendSyncing) => set({ backendSyncing }),
  backendEndpoint: "",
  setBackendEndpointValue: (backendEndpoint) => set({ backendEndpoint }),
  connectionStatus: "idle",
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  connectionError: "",
  setConnectionError: (connectionError) => set({ connectionError }),
  authEmail: "",
  setAuthEmail: (authEmail) => set({ authEmail }),
  authPassword: "",
  setAuthPassword: (authPassword) => set({ authPassword }),
  authSubmitting: false,
  setAuthSubmitting: (authSubmitting) => set({ authSubmitting }),
  authError: "",
  setAuthError: (authError) => set({ authError }),
}));
