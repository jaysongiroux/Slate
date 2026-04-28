import { useCallback, useRef, useState } from "react";
import { isEncryptedSettingKey } from "@slate/shared";
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
      summary?: MigrationSummary;
    }
  | { kind: "error"; message: string; mode: "push" | "reset"; canRetry: boolean }
  | { kind: "done"; mode: "push" | "reset" };

export interface UseServerMigrationOptions {
  oldEndpoint: string;
  newEndpoint: string;
  onClose: (committed: boolean) => void;
  getAccessToken: () => Promise<string | null>;
  setBackendEndpoint: (endpoint: string) => Promise<void>;
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
        .filter((s) => !isEncryptedSettingKey(s.key)),
    };
  }

  async function startPush() {
    if (cancelledRef.current) return;
    try {
      // STEP 1: inventory
      setState({ kind: "running", mode: "push", step: "Reading local data…", progress: null });
      const oldToken = await opts.getAccessToken();
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

      // STEP 2: download diagrams
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

      // STEP 3: download attachments
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

      // STEP 4: switch endpoints
      setState({
        kind: "running",
        mode: "push",
        step: "Switching endpoints…",
        progress: null,
        summary,
      });
      cancelReplication();
      await opts.setBackendEndpoint(opts.newEndpoint);
      switchedRef.current = true;

      // STEP 5: wait for new-server auth
      setState({ kind: "awaiting-new-server-auth", mode: "push", summary });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: "error", mode: "push", message, canRetry: !switchedRef.current });
    }
  }

  async function continuePushAfterAuth() {
    if (cancelledRef.current) return;
    try {
      const newToken = await opts.getAccessToken();
      if (!newToken) throw new Error("Not signed in to the new server");
      const local = localBundleRef.current;
      if (!local) throw new Error("Local data was not captured before the switch");

      const summary: MigrationSummary = {
        notes: local.notes.length,
        folders: local.folders.length,
        diagrams: downloadedDiagramsRef.current.length,
        attachments: downloadedAttachmentsRef.current.length,
        settings: local.settings.length,
      };

      // STEP 6a: folders
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

      // STEP 6b: notes
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

      // STEP 6c: diagrams
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

      // STEP 6d: settings
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

      // STEP 6e: attachments (one at a time; multipart can't be batched)
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

      // STEP 7: restart replication
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

  async function startReset() {
    if (cancelledRef.current) return;
    try {
      setState({
        kind: "running",
        mode: "reset",
        step: "Switching endpoints…",
        progress: null,
      });
      cancelReplication();
      await opts.setBackendEndpoint(opts.newEndpoint);
      switchedRef.current = true;
      setState({ kind: "awaiting-new-server-auth", mode: "reset" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: "error", mode: "reset", message, canRetry: !switchedRef.current });
    }
  }

  async function continueResetAfterAuth() {
    if (cancelledRef.current) return;
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

  function notifyAuthSucceeded() {
    if (state.kind !== "awaiting-new-server-auth") return;
    if (state.mode === "push") {
      void continuePushAfterAuth();
    } else {
      void continueResetAfterAuth();
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
    notifyAuthSucceeded,
    retry,
    cancel,
    close,
  };
}
