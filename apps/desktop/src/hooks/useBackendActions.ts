import { useEffect, useRef } from "react";
import type { DesktopSnapshot, LocalNoteSummary } from "@slate/shared";
import type { View as CalendarViewType } from "react-big-calendar";
import { toast } from "sonner";
import { useWorkspaceStore } from "../stores/workspace-store";
import { useAppStore } from "../stores/app-store";
import { useUiStore } from "../stores/ui-store";
import { useSyncStore } from "../stores/sync-store";
import {
  isSidebarMode,
  mainPanelModeForSidebarMode,
  stableBackendFingerprint,
} from "../lib/app-helpers";
import {
  checkBackendConnection,
  getCalendarReminderSettings,
  getCalendarVisibilityFilters,
  getLastCalendarDate,
  getLastCalendarView,
  getLastOpenNoteId,
  getLastSidebarMode,
  getSnapshot,
  loginWithOidc,
  loginWithPassword,
  refreshBackendStatus,
  setBackendEndpoint,
  setLastCalendarDate,
  setLastCalendarView,
  setLastSidebarMode,
  signOutBackend,
  type CalendarReminderSettings,
  type CalendarVisibilityFilters,
} from "../lib/api";
import { listenForSyncStatus } from "../lib/backend-sync.mjs";
import { slateDiagLog } from "../lib/slate-diag-log";

const BACKEND_STATUS_POLL_MS = 15000;

export function useBackendActions(params: {
  handleSelectNote: (noteId: string) => Promise<void>;
  flushPendingSave: () => Promise<void>;
  setCalendarVisibilityFiltersState: (v: CalendarVisibilityFilters | null) => void;
  setCalendarReminderSettingsState: (v: CalendarReminderSettings) => void;
  DEFAULT_CALENDAR_REMINDER_SETTINGS: CalendarReminderSettings;
}) {
  const {
    handleSelectNote,
    flushPendingSave,
    setCalendarVisibilityFiltersState,
    setCalendarReminderSettingsState,
    DEFAULT_CALENDAR_REMINDER_SETTINGS,
  } = params;

  const lastPolledBackendFingerprintRef = useRef<string | null>(null);
  const selectedNoteRef = useRef<LocalNoteSummary | null>(null);

  // Keep the ref in sync with store
  const selectedNote = useWorkspaceStore((s) => s.selectedNote);
  selectedNoteRef.current = selectedNote;

  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const backendEndpoint = useSyncStore((s) => s.backendEndpoint);
  const authEmail = useSyncStore((s) => s.authEmail);
  const authPassword = useSyncStore((s) => s.authPassword);

  // Selectors for effect dependencies
  const snapshotBackendEndpoint = useWorkspaceStore((s) => s.snapshot.backend.endpoint);
  const sidebarMode = useAppStore((s) => s.sidebarMode);
  const appLoading = useWorkspaceStore((s) => s.appLoading);
  const calendarView = useAppStore((s) => s.calendarView);
  const calendarDate = useAppStore((s) => s.calendarDate);

  function applyBackendConfig(nextBackend: DesktopSnapshot["backend"]) {
    useWorkspaceStore.getState().setSnapshot((current) => ({
      ...current,
      backend: {
        ...current.backend,
        ...nextBackend,
      },
    }));
  }

  async function refreshSnapshot() {
    try {
      const nextSnapshot = await getSnapshot();
      useWorkspaceStore.getState().setSnapshot(nextSnapshot);
      lastPolledBackendFingerprintRef.current = stableBackendFingerprint(nextSnapshot.backend);
      if (!useUiStore.getState().settingsOpen) {
        useSyncStore.getState().setBackendEndpointValue(nextSnapshot.backend.endpoint);
      }

      const { selectedNoteId } = useAppStore.getState();
      // RxDB era: snapshot notes are empty; selection is validated against local data elsewhere.
      if (
        selectedNoteId &&
        nextSnapshot.notes.length > 0 &&
        !nextSnapshot.notes.some((note) => note.id === selectedNoteId)
      ) {
        useAppStore.getState().setSelectedNoteId("");
        useWorkspaceStore.getState().setSelectedNote(null);
      }
    } catch (error) {
      slateDiagLog("renderer.snapshot", "refresh_snapshot_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      useWorkspaceStore
        .getState()
        .setErrorMessage(error instanceof Error ? error.message : "Failed to load workspace");
    }
  }

  async function updateBackendStatus() {
    try {
      const backend = await refreshBackendStatus();
      const fp = stableBackendFingerprint(backend);
      const liveFp = stableBackendFingerprint(useWorkspaceStore.getState().snapshot.backend);
      // Only skip when the server state, our last poll, and the UI snapshot all agree.
      // Otherwise we can get stuck after HMR / initial placeholder / any desync: ref matches
      // the latest IPC result while Zustand still shows `initialSnapshot()` or stale reachability.
      if (fp === lastPolledBackendFingerprintRef.current && fp === liveFp) {
        return;
      }
      lastPolledBackendFingerprintRef.current = fp;
      slateDiagLog("renderer.backend_poll", "fingerprint_changed", {
        authStatus: backend.authStatus,
        backendReachable: backend.backendReachable,
        tokenExpiresAtUnix: backend.tokenExpiresAtUnix ?? null,
        liveReachable: useWorkspaceStore.getState().snapshot.backend.backendReachable,
      });
      applyBackendConfig(backend);
      await refreshSnapshot();
    } catch (err) {
      slateDiagLog("renderer.backend_poll", "refresh_backend_status_failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      // Keep the last known snapshot if a background status poll fails unexpectedly.
    }
  }

  async function handleTestConnection() {
    const endpoint = useSyncStore.getState().backendEndpoint.trim();
    if (!endpoint) return;
    useSyncStore.getState().setConnectionStatus("testing");
    useSyncStore.getState().setConnectionError("");
    try {
      const reachable = await checkBackendConnection(endpoint);
      useSyncStore.getState().setConnectionStatus(reachable ? "success" : "error");
      useSyncStore
        .getState()
        .setConnectionError(reachable ? "" : "Health check failed at /api/health.");
    } catch (error) {
      useSyncStore.getState().setConnectionStatus("error");
      useSyncStore
        .getState()
        .setConnectionError(error instanceof Error ? error.message : "Connection failed");
    }
  }

  async function handleSaveEndpoint() {
    const endpoint = useSyncStore.getState().backendEndpoint.trim();
    if (!endpoint) return;

    useSyncStore.getState().setConnectionStatus("testing");
    useSyncStore.getState().setConnectionError("");

    try {
      const savedBackend = await setBackendEndpoint(endpoint);
      applyBackendConfig(savedBackend);
      useSyncStore.getState().setBackendEndpointValue(savedBackend.endpoint);

      const refreshedBackend = await refreshBackendStatus();
      applyBackendConfig(refreshedBackend);
      await refreshSnapshot();
      useSyncStore
        .getState()
        .setConnectionStatus(refreshedBackend.backendReachable ? "success" : "error");
      useSyncStore
        .getState()
        .setConnectionError(
          refreshedBackend.backendReachable ? "" : "Saved, but the backend is offline.",
        );
      useSyncStore.getState().setAuthPassword("");
      useSyncStore.getState().setAuthError("");
    } catch (error) {
      useSyncStore.getState().setConnectionStatus("error");
      useSyncStore
        .getState()
        .setConnectionError(error instanceof Error ? error.message : "Failed to save endpoint");
      useWorkspaceStore
        .getState()
        .setErrorMessage(error instanceof Error ? error.message : "Failed to save endpoint");
    }
  }

  async function handleLogin() {
    const { authEmail: email, authPassword: password } = useSyncStore.getState();
    if (!email.trim() || !password) {
      return;
    }

    useSyncStore.getState().setAuthSubmitting(true);
    useSyncStore.getState().setAuthError("");

    try {
      const backend = await loginWithPassword({
        email: email.trim(),
        password,
      });
      applyBackendConfig(backend);
      useSyncStore.getState().setAuthPassword("");
      useSyncStore.getState().setConnectionStatus("idle");
      useSyncStore.getState().setConnectionError("");
      await refreshSnapshot();
      slateDiagLog("renderer.auth", "password_login_ok", {});
    } catch (error) {
      slateDiagLog("renderer.auth", "password_login_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      useSyncStore.getState().setAuthError(error instanceof Error ? error.message : "Login failed");
    } finally {
      useSyncStore.getState().setAuthSubmitting(false);
    }
  }

  async function handleOidcLogin(providerId: string) {
    useSyncStore.getState().setAuthSubmitting(true);
    useSyncStore.getState().setAuthError("");

    try {
      const backend = await loginWithOidc(providerId);
      applyBackendConfig(backend);
      useSyncStore.getState().setConnectionStatus("idle");
      useSyncStore.getState().setConnectionError("");
      await refreshSnapshot();
      slateDiagLog("renderer.auth", "oidc_login_ok", { providerId });
    } catch (error) {
      slateDiagLog("renderer.auth", "oidc_login_failed", {
        providerId,
        message: error instanceof Error ? error.message : String(error),
      });
      useSyncStore
        .getState()
        .setAuthError(error instanceof Error ? error.message : "OIDC login failed");
    } finally {
      useSyncStore.getState().setAuthSubmitting(false);
    }
  }

  async function handleSignOut() {
    slateDiagLog("renderer.auth", "sign_out_clicked", {});
    try {
      const backend = await signOutBackend();
      applyBackendConfig(backend);
      useSyncStore.getState().setAuthPassword("");
      useSyncStore.getState().setAuthError("");
      await refreshSnapshot();
      slateDiagLog("renderer.auth", "sign_out_complete", {});
    } catch (error) {
      useSyncStore
        .getState()
        .setAuthError(error instanceof Error ? error.message : "Failed to sign out");
    }
  }

  async function handleFullSync() {
    useSyncStore.getState().setBackendSyncing(true);
    try {
      await refreshSnapshot();
      toast.success("Refreshed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      useSyncStore.getState().setBackendSyncing(false);
    }
  }

  async function initializeApp() {
    try {
      const [
        nextSnapshot,
        lastNoteId,
        lastSidebarMode,
        savedCalendarVisibilityFilters,
        savedCalendarReminderSettings,
        savedCalendarView,
        savedCalendarDate,
      ] = await Promise.all([
        getSnapshot(),
        getLastOpenNoteId(),
        getLastSidebarMode(),
        getCalendarVisibilityFilters(),
        getCalendarReminderSettings(),
        getLastCalendarView(),
        getLastCalendarDate(),
      ]);
      useWorkspaceStore.getState().setSnapshot(nextSnapshot);
      lastPolledBackendFingerprintRef.current = stableBackendFingerprint(nextSnapshot.backend);
      // Reconcile reachability before slow work (note load) so we do not sit on `initialSnapshot`
      // or a stale offline flag while the main process already knows the backend is up.
      await updateBackendStatus();
      const backendAfterPoll = useWorkspaceStore.getState().snapshot.backend;
      slateDiagLog("renderer.init", "app_initialized", {
        authStatus: backendAfterPoll.authStatus,
        backendReachable: backendAfterPoll.backendReachable,
        endpointSet: Boolean(backendAfterPoll.endpoint?.trim()),
      });
      setCalendarVisibilityFiltersState(savedCalendarVisibilityFilters);
      setCalendarReminderSettingsState(
        savedCalendarReminderSettings ?? DEFAULT_CALENDAR_REMINDER_SETTINGS,
      );
      if (savedCalendarView)
        useAppStore.getState().setCalendarView(savedCalendarView as CalendarViewType);
      if (savedCalendarDate) useAppStore.getState().setCalendarDate(new Date(savedCalendarDate));
      if (!useUiStore.getState().settingsOpen) {
        useSyncStore.getState().setBackendEndpointValue(backendAfterPoll.endpoint);
      }

      const restoredSidebarMode = isSidebarMode(lastSidebarMode) ? lastSidebarMode : "notes";
      const appStore = useAppStore.getState();
      appStore.setSidebarMode(restoredSidebarMode);
      appStore.setMainPanelMode(mainPanelModeForSidebarMode(restoredSidebarMode));

      const targetId =
        lastNoteId && nextSnapshot.notes.some((n: LocalNoteSummary) => n.id === lastNoteId)
          ? lastNoteId
          : nextSnapshot.notes[0]?.id;
      if (targetId) {
        await handleSelectNote(targetId);
      }
    } finally {
      useWorkspaceStore.getState().setAppLoading(false);
    }
  }

  // --- Effects ---

  // Initialize app on mount
  useEffect(() => {
    void initializeApp();
  }, []);

  // Listen for sync status
  useEffect(() => {
    return listenForSyncStatus(window, (status: string) => {
      useSyncStore.getState().setBackendSyncing(status === "syncing");
    });
  }, []);

  // Workspace changed handler
  useEffect(() => {
    const api = (window as any).slateDesktop;
    if (!api?.onWorkspaceChanged) return;

    api.onWorkspaceChanged((diskRelPaths: string[]) => {
      const paths = Array.isArray(diskRelPaths) ? diskRelPaths : [];
      const current = selectedNoteRef.current;
      void (async () => {
        if (current && paths.length > 0) {
          const norm = (p: string) => p.replace(/\\/g, "/");
          const openPath = norm(current.path);
          const touchedOpenNote = paths.some((p) => norm(p) === openPath);
          if (touchedOpenNote) {
            try {
              await reloadSelectedNoteFromDisk(current.id);
              toast("This note changed on disk and was reloaded.");
            } catch {
              // refreshSnapshot below will reconcile selection if the note disappeared
            }
          }
        }
        await refreshSnapshot();
      })();
    });

    return () => api.offWorkspaceChanged?.();
  }, []);

  // Backend endpoint sync effect
  useEffect(() => {
    if (!settingsOpen) {
      useSyncStore.getState().setBackendEndpointValue(snapshotBackendEndpoint);
    }
  }, [snapshotBackendEndpoint, settingsOpen]);

  // Backend status polling interval
  useEffect(() => {
    void updateBackendStatus();
    const intervalId = window.setInterval(() => {
      void updateBackendStatus();
    }, BACKEND_STATUS_POLL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  // Persist sidebar mode
  useEffect(() => {
    if (appLoading) return;
    void setLastSidebarMode(sidebarMode);
  }, [sidebarMode, appLoading]);

  // Persist calendar view
  useEffect(() => {
    if (appLoading) return;
    void setLastCalendarView(calendarView);
  }, [appLoading, calendarView]);

  // Persist calendar date
  useEffect(() => {
    if (appLoading) return;
    void setLastCalendarDate(calendarDate.toISOString());
  }, [appLoading, calendarDate]);

  // Helper used by workspace-changed handler
  async function reloadSelectedNoteFromDisk(noteId: string) {
    // Delegate to the note-level reload; inline here for workspace-changed only
    const { loadNote } = await import("../lib/api");
    const loaded = await loadNote(noteId);
    if (selectedNoteRef.current?.id !== noteId) {
      return;
    }
    useWorkspaceStore.getState().setSelectedNote(loaded);
    useSyncStore.getState().setSaveState("saved");
  }

  return {
    refreshSnapshot,
    applyBackendConfig,
    updateBackendStatus,
    handleTestConnection,
    handleSaveEndpoint,
    handleLogin,
    handleOidcLogin,
    handleSignOut,
    handleFullSync,
    initializeApp,
  };
}
