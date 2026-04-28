import { useCallback, useRef, useState } from "react";
import type { BackendAuthProvider } from "@slate/shared";
import { isMigrationSkippedSettingKey } from "@slate/shared";
import {
  useDatabase,
  useDatabaseReplicationControl,
  useDatabaseReset,
} from "../db/DatabaseProvider";
import {
  bulkImportAttachment,
  bulkImportDiagrams,
  bulkImportFolders,
  bulkImportNotes,
  bulkImportSettings,
  downloadAttachment,
  getDiagram,
  listAttachments,
  listDiagrams,
  type MigrationAttachmentMeta,
  type MigrationDiagram,
} from "../lib/api/migration-api";

const BULK_CHUNK = 200;

interface MigrationSummary {
  notes: number;
  folders: number;
  diagrams: number;
  attachments: number;
  settings: number;
}

interface NewServerProbe {
  backendReachable: boolean;
  authProviders: BackendAuthProvider[];
}

export type MigrationState =
  | { kind: "chooser" }
  | {
      kind: "running";
      mode: "push" | "reset";
      step: string;
      progress: { done: number; total: number } | null;
      summary?: MigrationSummary;
    }
  | {
      kind: "awaiting-new-server-auth";
      mode: "push" | "reset";
      probe: NewServerProbe;
      authError: string;
      authSubmitting: boolean;
      summary?: MigrationSummary;
    }
  | { kind: "error"; message: string; mode: "push" | "reset"; canRetry: boolean }
  | { kind: "done"; mode: "push" | "reset" };

interface DesktopBridge {
  probeBackendStatus: (endpoint: string) => Promise<NewServerProbe>;
  loginWithPasswordAtEndpoint: (
    endpoint: string,
    payload: { email: string; password: string; totpCode?: string },
  ) => Promise<unknown>;
  loginWithOidcAtEndpoint: (endpoint: string, providerId: string) => Promise<unknown>;
  commitBackendSwitch: (endpoint: string, loginResult: unknown) => Promise<unknown>;
  cancelOidc: () => Promise<void>;
  getConfig: (key: string) => Promise<string | null>;
}

function bridge(): DesktopBridge {
  return (window as any).slateDesktop as DesktopBridge;
}

export interface UseServerMigrationOptions {
  oldEndpoint: string;
  newEndpoint: string;
  onClose: (committed: boolean) => void;
}

export function useServerMigration(opts: UseServerMigrationOptions) {
  const db = useDatabase();
  const resetFromServer = useDatabaseReset();
  const { cancelReplication, restartReplication } = useDatabaseReplicationControl();
  const [state, setState] = useState<MigrationState>({ kind: "chooser" });
  const cancelledRef = useRef(false);
  const switchedRef = useRef(false);

  const downloadedDiagramsRef = useRef<MigrationDiagram[]>([]);
  const downloadedAttachmentsRef = useRef<
    Array<{ meta: MigrationAttachmentMeta; blob: Blob }>
  >([]);
  const localBundleRef = useRef<{
    notes: any[];
    folders: any[];
    settings: any[];
  } | null>(null);
  const summaryRef = useRef<MigrationSummary | null>(null);
  const probeRef = useRef<NewServerProbe | null>(null);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setState({ kind: "chooser" });
    opts.onClose(switchedRef.current);
  }, [opts]);

  const close = useCallback(
    (committed: boolean) => {
      opts.onClose(committed);
    },
    [opts],
  );

  async function readLocalBundle() {
    if (!db) throw new Error("Local database is not ready");
    const notes = await db.notes.find().exec();
    const folders = await db.folders.find().exec();
    const settings = await db.settings.find().exec();

    return {
      notes: notes.map((d) => d.toJSON()),
      folders: folders.map((d) => d.toJSON()),
      settings: settings
        .map((d) => d.toJSON())
        .filter((s) => !isMigrationSkippedSettingKey(s.key)),
    };
  }

  async function startPush() {
    if (cancelledRef.current) return;
    try {
      // STEP 1: inventory
      setState({ kind: "running", mode: "push", step: "Reading local data…", progress: null });
      const oldToken = await bridge().getConfig("accessToken");
      if (!oldToken) throw new Error("Not signed in to the current server");
      const local = await readLocalBundle();
      localBundleRef.current = local;

      const diagramsList = await listDiagrams(opts.oldEndpoint, oldToken);
      const attachmentsList = await listAttachments(opts.oldEndpoint, oldToken);

      const summary: MigrationSummary = {
        notes: local.notes.length,
        folders: local.folders.length,
        diagrams: diagramsList.length,
        attachments: attachmentsList.length,
        settings: local.settings.length,
      };
      summaryRef.current = summary;

      // STEP 2: download diagrams from old server
      setState({
        kind: "running",
        mode: "push",
        step: "Downloading diagrams from current server…",
        progress: { done: 0, total: diagramsList.length },
        summary,
      });
      const diagrams: MigrationDiagram[] = [];
      for (let i = 0; i < diagramsList.length; i++) {
        if (cancelledRef.current) return;
        const dg = await getDiagram(opts.oldEndpoint, oldToken, diagramsList[i].id);
        diagrams.push(dg);
        setState({
          kind: "running",
          mode: "push",
          step: "Downloading diagrams from current server…",
          progress: { done: i + 1, total: diagramsList.length },
          summary,
        });
      }
      downloadedDiagramsRef.current = diagrams;

      // STEP 3: download attachments from old server
      setState({
        kind: "running",
        mode: "push",
        step: "Downloading attachments from current server…",
        progress: { done: 0, total: attachmentsList.length },
        summary,
      });
      const attachments: Array<{ meta: MigrationAttachmentMeta; blob: Blob }> = [];
      for (let i = 0; i < attachmentsList.length; i++) {
        if (cancelledRef.current) return;
        const meta = attachmentsList[i];
        const blob = await downloadAttachment(opts.oldEndpoint, oldToken, meta.id);
        attachments.push({ meta, blob });
        setState({
          kind: "running",
          mode: "push",
          step: "Downloading attachments from current server…",
          progress: { done: i + 1, total: attachmentsList.length },
          summary,
        });
      }
      downloadedAttachmentsRef.current = attachments;

      // STEP 4: probe new server (no commit yet) and prompt for new credentials
      setState({
        kind: "running",
        mode: "push",
        step: "Checking new server…",
        progress: null,
        summary,
      });
      const probe = await bridge().probeBackendStatus(opts.newEndpoint);
      probeRef.current = probe;
      if (!probe.backendReachable) {
        throw new Error("Could not reach the new server. Check the URL and try again.");
      }
      setState({
        kind: "awaiting-new-server-auth",
        mode: "push",
        probe,
        authError: "",
        authSubmitting: false,
        summary,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: "error", mode: "push", message, canRetry: !switchedRef.current });
    }
  }

  async function startReset() {
    if (cancelledRef.current) return;
    try {
      setState({
        kind: "running",
        mode: "reset",
        step: "Checking new server…",
        progress: null,
      });
      const probe = await bridge().probeBackendStatus(opts.newEndpoint);
      probeRef.current = probe;
      if (!probe.backendReachable) {
        throw new Error("Could not reach the new server. Check the URL and try again.");
      }
      setState({
        kind: "awaiting-new-server-auth",
        mode: "reset",
        probe,
        authError: "",
        authSubmitting: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: "error", mode: "reset", message, canRetry: true });
    }
  }

  async function submitPasswordLogin(email: string, password: string) {
    if (state.kind !== "awaiting-new-server-auth") return;
    const mode = state.mode;
    const probe = state.probe;
    const summary = state.summary;
    setState({
      kind: "awaiting-new-server-auth",
      mode,
      probe,
      authError: "",
      authSubmitting: true,
      summary,
    });
    try {
      const loginResult = await bridge().loginWithPasswordAtEndpoint(opts.newEndpoint, {
        email,
        password,
      });
      await commitAndContinue(mode, loginResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign-in failed";
      setState({
        kind: "awaiting-new-server-auth",
        mode,
        probe,
        authError: message,
        authSubmitting: false,
        summary,
      });
    }
  }

  async function submitOidcLogin(providerId: string) {
    if (state.kind !== "awaiting-new-server-auth") return;
    const mode = state.mode;
    const probe = state.probe;
    const summary = state.summary;
    setState({
      kind: "awaiting-new-server-auth",
      mode,
      probe,
      authError: "",
      authSubmitting: true,
      summary,
    });
    try {
      const loginResult = await bridge().loginWithOidcAtEndpoint(opts.newEndpoint, providerId);
      await commitAndContinue(mode, loginResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign-in failed";
      setState({
        kind: "awaiting-new-server-auth",
        mode,
        probe,
        authError: message,
        authSubmitting: false,
        summary,
      });
    }
  }

  async function cancelOidc() {
    try {
      await bridge().cancelOidc();
    } catch {
      // best-effort
    }
  }

  async function commitAndContinue(mode: "push" | "reset", loginResult: unknown) {
    // Atomic transition: clear old auth, set new endpoint, store new tokens.
    cancelReplication();
    await bridge().commitBackendSwitch(opts.newEndpoint, loginResult);
    switchedRef.current = true;

    if (mode === "push") {
      await runPushUploadPhase();
    } else {
      await runResetPhase();
    }
  }

  async function runPushUploadPhase() {
    try {
      const newToken = await bridge().getConfig("accessToken");
      if (!newToken) throw new Error("New server token missing after switch");
      const local = localBundleRef.current;
      if (!local) throw new Error("Local data was not captured before the switch");
      const summary = summaryRef.current ?? {
        notes: local.notes.length,
        folders: local.folders.length,
        diagrams: downloadedDiagramsRef.current.length,
        attachments: downloadedAttachmentsRef.current.length,
        settings: local.settings.length,
      };

      // 6a folders
      setState({
        kind: "running",
        mode: "push",
        step: "Uploading folders…",
        progress: { done: 0, total: local.folders.length },
        summary,
      });
      for (let i = 0; i < local.folders.length; i += BULK_CHUNK) {
        const chunk = local.folders.slice(i, i + BULK_CHUNK);
        await bulkImportFolders(opts.newEndpoint, newToken, chunk);
        setState({
          kind: "running",
          mode: "push",
          step: "Uploading folders…",
          progress: {
            done: Math.min(i + BULK_CHUNK, local.folders.length),
            total: local.folders.length,
          },
          summary,
        });
      }

      // 6b notes
      setState({
        kind: "running",
        mode: "push",
        step: "Uploading notes…",
        progress: { done: 0, total: local.notes.length },
        summary,
      });
      for (let i = 0; i < local.notes.length; i += BULK_CHUNK) {
        const chunk = local.notes.slice(i, i + BULK_CHUNK);
        await bulkImportNotes(opts.newEndpoint, newToken, chunk);
        setState({
          kind: "running",
          mode: "push",
          step: "Uploading notes…",
          progress: {
            done: Math.min(i + BULK_CHUNK, local.notes.length),
            total: local.notes.length,
          },
          summary,
        });
      }

      // 6c diagrams
      setState({
        kind: "running",
        mode: "push",
        step: "Uploading diagrams…",
        progress: { done: 0, total: downloadedDiagramsRef.current.length },
        summary,
      });
      for (let i = 0; i < downloadedDiagramsRef.current.length; i += BULK_CHUNK) {
        const chunk = downloadedDiagramsRef.current.slice(i, i + BULK_CHUNK);
        await bulkImportDiagrams(opts.newEndpoint, newToken, chunk);
        setState({
          kind: "running",
          mode: "push",
          step: "Uploading diagrams…",
          progress: {
            done: Math.min(i + BULK_CHUNK, downloadedDiagramsRef.current.length),
            total: downloadedDiagramsRef.current.length,
          },
          summary,
        });
      }

      // 6d settings
      setState({
        kind: "running",
        mode: "push",
        step: "Uploading settings…",
        progress: { done: 0, total: local.settings.length },
        summary,
      });
      for (let i = 0; i < local.settings.length; i += BULK_CHUNK) {
        const chunk = local.settings.slice(i, i + BULK_CHUNK);
        await bulkImportSettings(opts.newEndpoint, newToken, chunk);
        setState({
          kind: "running",
          mode: "push",
          step: "Uploading settings…",
          progress: {
            done: Math.min(i + BULK_CHUNK, local.settings.length),
            total: local.settings.length,
          },
          summary,
        });
      }

      // 6e attachments
      setState({
        kind: "running",
        mode: "push",
        step: "Uploading attachments…",
        progress: { done: 0, total: downloadedAttachmentsRef.current.length },
        summary,
      });
      for (let i = 0; i < downloadedAttachmentsRef.current.length; i++) {
        if (cancelledRef.current) return;
        const { meta, blob } = downloadedAttachmentsRef.current[i];
        await bulkImportAttachment(opts.newEndpoint, newToken, {
          id: meta.id,
          blob,
          containerType: meta.containerType,
          containerId: meta.containerId,
          originalName: meta.originalName,
          mimeType: meta.mimeType,
        });
        setState({
          kind: "running",
          mode: "push",
          step: "Uploading attachments…",
          progress: { done: i + 1, total: downloadedAttachmentsRef.current.length },
          summary,
        });
      }

      // restart replication against new endpoint
      setState({
        kind: "running",
        mode: "push",
        step: "Restarting sync…",
        progress: null,
        summary,
      });
      await restartReplication();

      setState({ kind: "done", mode: "push" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: "error", mode: "push", message, canRetry: true });
    }
  }

  async function runResetPhase() {
    try {
      setState({
        kind: "running",
        mode: "reset",
        step: "Resetting local data from new server…",
        progress: null,
      });
      await resetFromServer();
      setState({ kind: "done", mode: "reset" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: "error", mode: "reset", message, canRetry: true });
    }
  }

  function retry() {
    if (state.kind !== "error") return;
    if (state.mode === "push") void startPush();
    else void startReset();
  }

  return {
    state,
    switched: switchedRef.current,
    startPush,
    startReset,
    submitPasswordLogin,
    submitOidcLogin,
    cancelOidc,
    retry,
    cancel,
    close,
  };
}
