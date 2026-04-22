import { create } from "zustand";
import {
  mcpApi,
  type McpServerPublic,
  type McpServerStatusPublic,
  type McpServerSaveInput,
} from "../lib/api/mcp-api";

interface McpState {
  servers: McpServerPublic[];
  status: McpServerStatusPublic[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  pollIntervalId: number | null;
  visibilityHandler: (() => void) | null;

  loadServers: () => Promise<void>;
  saveServers: (input: McpServerSaveInput[]) => Promise<McpServerPublic[]>;
  refreshStatus: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

const POLL_INTERVAL_MS = 60_000;

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  status: [],
  loading: false,
  saving: false,
  error: null,
  pollIntervalId: null,
  visibilityHandler: null,

  loadServers: async () => {
    set({ loading: true, error: null });
    try {
      const servers = await mcpApi.getServers();
      set({ servers, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  saveServers: async (input) => {
    set({ saving: true, error: null });
    try {
      const servers = await mcpApi.saveServers(input);
      set({ servers, saving: false });
      // refresh status immediately after a save
      void get().refreshStatus();
      return servers;
    } catch (err) {
      set({ saving: false, error: (err as Error).message });
      throw err;
    }
  },

  refreshStatus: async () => {
    try {
      const status = await mcpApi.getStatus();
      set({ status });
    } catch (err) {
      // Don't surface polling errors to the UI loudly; the badge will simply not update.
      // eslint-disable-next-line no-console
      console.warn("[mcp] status refresh failed:", err);
    }
  },

  startPolling: () => {
    if (get().pollIntervalId != null) return;
    void get().refreshStatus();
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void get().refreshStatus();
    }, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (!document.hidden) void get().refreshStatus();
    };
    document.addEventListener("visibilitychange", onVisibility);

    set({ pollIntervalId: id, visibilityHandler: onVisibility });
  },

  stopPolling: () => {
    const { pollIntervalId, visibilityHandler } = get();
    if (pollIntervalId != null) window.clearInterval(pollIntervalId);
    if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
    set({ pollIntervalId: null, visibilityHandler: null });
  },
}));
