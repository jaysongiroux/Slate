import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AttachmentIdMap,
  BackendAuthProvider,
  DesktopSnapshot,
} from "@slate/shared";
import {
  isMigrationSkippedSettingKey,
  remapAttachmentIdsInDiagramScene,
  remapAttachmentIdsInMarkdown,
  remapAttachmentIdsInNoteContent,
} from "@slate/shared";
import {
  useDatabase,
  useDatabaseReplicationControl,
  useDatabaseReset,
} from "../db/DatabaseProvider";
import { useSyncStore } from "../stores/sync-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import { getSnapshot } from "../lib/api/notes-api";
import {
  bulkImportAttachment,
  bulkImportDiagrams,
  bulkImportFolders,
  bulkImportNotes,
  bulkImportSettings,
  checkIdConflicts,
  downloadAttachment,
  getDiagram,
  listAttachments,
  listDiagrams,
  type IdConflictReport,
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

export interface ConflictCounts {
  folders: number;
  notes: number;
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
      probe: NewServerProbe;
      authError: string;
      authSubmitting: boolean;
      summary?: MigrationSummary;
    }
  | {
      kind: "awaiting-conflict-resolution";
      mode: "push";
      counts: ConflictCounts;
      summary?: MigrationSummary;
    }
  | { kind: "error"; message: string; mode: "push" | "reset"; canRetry: boolean }
  | {
      kind: "done";
      mode: "push" | "reset";
      skipped?: {
        folders: number;
        notes: number;
        diagrams: number;
        settings: number;
        attachments: number;
      };
    };

interface DesktopBridge {
  probeBackendStatus: (endpoint: string) => Promise<NewServerProbe>;
  loginWithPasswordAtEndpoint: (
    endpoint: string,
    payload: { email: string; password: string; totpCode?: string },
  ) => Promise<unknown>;
  loginWithOidcAtEndpoint: (endpoint: string, providerId: string) => Promise<unknown>;
  commitBackendSwitch: (
    endpoint: string,
    loginResult: unknown,
  ) => Promise<DesktopSnapshot["backend"]>;
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

export interface LocalDataCounts {
  notes: number;
  folders: number;
  migratableSettings: number;
  skippedExtensionSettings: number;
}

export function useServerMigration(opts: UseServerMigrationOptions) {
  const db = useDatabase();
  const resetFromServer = useDatabaseReset();
  const { cancelReplication, restartReplication } = useDatabaseReplicationControl();
  const [state, setState] = useState<MigrationState>({ kind: "chooser" });
  const [localCounts, setLocalCounts] = useState<LocalDataCounts | null>(null);
  const cancelledRef = useRef(false);
  const switchedRef = useRef(false);

  // Pre-compute local-data counts so the chooser can show what's at stake
  // before the user commits to Push or Reset.
  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    void (async () => {
      try {
        const [notes, folders, settings] = await Promise.all([
          db.notes.find().exec(),
          db.folders.find().exec(),
          db.settings.find().exec(),
        ]);
        if (cancelled) return;
        const settingsJson = settings.map((d) => d.toJSON());
        const migratable = settingsJson.filter(
          (s) => !isMigrationSkippedSettingKey(s.key),
        ).length;
        setLocalCounts({
          notes: notes.length,
          folders: folders.length,
          migratableSettings: migratable,
          skippedExtensionSettings: settingsJson.length - migratable,
        });
      } catch {
        if (!cancelled) setLocalCounts(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

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
  const pendingLoginResultRef = useRef<unknown>(null);
  const pendingConflictsRef = useRef<IdConflictReport | null>(null);

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
    // For push, run an ID-conflict preflight against the new server using the
    // freshly issued (but not-yet-committed) token. If anything would land
    // under another user's id, pause and ask the user how to proceed before
    // we touch any state. For reset, there's nothing to conflict with — go
    // straight to the commit.
    if (mode === "push") {
      const local = localBundleRef.current;
      if (!local) throw new Error("Local data was not captured before the switch");
      const accessToken = (loginResult as { tokens?: { accessToken?: string } })?.tokens
        ?.accessToken;
      if (!accessToken) {
        throw new Error("New-server login result is missing an access token");
      }

      const conflicts = await checkIdConflicts(opts.newEndpoint, accessToken, {
        folders: local.folders.map((f) => f.id),
        notes: local.notes.map((n) => n.id),
        diagrams: downloadedDiagramsRef.current.map((d) => d.id),
        attachments: downloadedAttachmentsRef.current.map((a) => a.meta.id),
        settings: local.settings.map((s) => s.id),
      });

      const counts: ConflictCounts = {
        folders: conflicts.folders.length,
        notes: conflicts.notes.length,
        diagrams: conflicts.diagrams.length,
        attachments: conflicts.attachments.length,
        settings: conflicts.settings.length,
      };
      const total =
        counts.folders + counts.notes + counts.diagrams + counts.attachments + counts.settings;

      if (total > 0) {
        pendingLoginResultRef.current = loginResult;
        pendingConflictsRef.current = conflicts;
        setState({
          kind: "awaiting-conflict-resolution",
          mode: "push",
          counts,
          summary: summaryRef.current ?? undefined,
        });
        return;
      }
    }

    await commitSwitchAndUpload(mode, loginResult);
  }

  async function commitSwitchAndUpload(mode: "push" | "reset", loginResult: unknown) {
    // Atomic transition: clear old auth, set new endpoint, store new tokens.
    cancelReplication();
    const newBackend = await bridge().commitBackendSwitch(opts.newEndpoint, loginResult);
    switchedRef.current = true;

    // Propagate the post-switch state into the renderer stores so the rest of
    // the app (SettingsDialog's "Saved endpoint", auth status banner, etc.)
    // reflects the new server immediately — no app reload required.
    useWorkspaceStore.getState().setSnapshot((current) => ({
      ...current,
      backend: { ...current.backend, ...newBackend },
    }));
    useSyncStore.getState().setBackendEndpointValue(newBackend.endpoint);
    try {
      const fresh = await getSnapshot();
      useWorkspaceStore.getState().setSnapshot(fresh);
      useSyncStore.getState().setBackendEndpointValue(fresh.backend.endpoint);
    } catch {
      // Best-effort; the partial snapshot above is still correct for the
      // backend slice that the dialog cares about.
    }

    if (mode === "push") {
      await runPushUploadPhase();
    } else {
      await runResetPhase();
    }
  }

  /**
   * Regenerate IDs for the conflicting items only. For attachments, build an
   * id map and rewrite every reference inside notes and diagrams. For other
   * resource types there are no incoming references, so a fresh id is enough.
   */
  function applyConflictRegeneration(conflicts: IdConflictReport): void {
    const local = localBundleRef.current;
    if (!local) return;

    const newId = (): string => {
      const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
      return c?.randomUUID ? c.randomUUID() : `mig-${Math.random().toString(36).slice(2, 14)}`;
    };

    // Folders
    if (conflicts.folders.length) {
      const conflictSet = new Set(conflicts.folders);
      local.folders = local.folders.map((f) =>
        conflictSet.has(f.id) ? { ...f, id: newId() } : f,
      );
    }

    // Settings
    if (conflicts.settings.length) {
      const conflictSet = new Set(conflicts.settings);
      local.settings = local.settings.map((s) =>
        conflictSet.has(s.id) ? { ...s, id: newId() } : s,
      );
    }

    // Attachments — build oldId -> newId map first so we can rewrite refs
    const attachmentIdMap: Record<string, string> = {};
    if (conflicts.attachments.length) {
      const conflictSet = new Set(conflicts.attachments);
      downloadedAttachmentsRef.current = downloadedAttachmentsRef.current.map(
        ({ meta, blob }) => {
          if (!conflictSet.has(meta.id)) return { meta, blob };
          const remapped = newId();
          attachmentIdMap[meta.id] = remapped;
          return { meta: { ...meta, id: remapped }, blob };
        },
      );
    }

    // Diagrams: regen any conflicting id, then remap attachment refs in scenes.
    if (conflicts.diagrams.length) {
      const conflictSet = new Set(conflicts.diagrams);
      downloadedDiagramsRef.current = downloadedDiagramsRef.current.map((d) =>
        conflictSet.has(d.id) ? { ...d, id: newId() } : d,
      );
    }
    if (Object.keys(attachmentIdMap).length > 0) {
      downloadedDiagramsRef.current = downloadedDiagramsRef.current.map((d) => ({
        ...d,
        scene: remapAttachmentIdsInDiagramScene(d.scene, attachmentIdMap),
      }));
    }

    // Notes: regen any conflicting id, then remap attachment refs in content
    // and markdown.
    if (conflicts.notes.length) {
      const conflictSet = new Set(conflicts.notes);
      local.notes = local.notes.map((n) =>
        conflictSet.has(n.id) ? { ...n, id: newId() } : n,
      );
    }
    if (Object.keys(attachmentIdMap).length > 0) {
      const idMap: AttachmentIdMap = attachmentIdMap;
      local.notes = local.notes.map((n) => ({
        ...n,
        content: remapAttachmentIdsInNoteContent(n.content, idMap),
        markdown:
          typeof n.markdown === "string"
            ? remapAttachmentIdsInMarkdown(n.markdown, idMap)
            : n.markdown,
      }));
    }
  }

  async function regenerateAndContinue() {
    if (state.kind !== "awaiting-conflict-resolution") return;
    const conflicts = pendingConflictsRef.current;
    const loginResult = pendingLoginResultRef.current;
    if (!conflicts || !loginResult) {
      setState({
        kind: "error",
        mode: "push",
        message: "Internal error: pending migration state was lost",
        canRetry: false,
      });
      return;
    }
    try {
      applyConflictRegeneration(conflicts);
      pendingLoginResultRef.current = null;
      pendingConflictsRef.current = null;
      await commitSwitchAndUpload("push", loginResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: "error", mode: "push", message, canRetry: !switchedRef.current });
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

      const skipped = { folders: 0, notes: 0, diagrams: 0, settings: 0, attachments: 0 };

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
        const r = await bulkImportFolders(opts.newEndpoint, newToken, chunk);
        skipped.folders += r.skipped ?? 0;
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
        const r = await bulkImportNotes(opts.newEndpoint, newToken, chunk);
        skipped.notes += r.skipped ?? 0;
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
        const r = await bulkImportDiagrams(opts.newEndpoint, newToken, chunk);
        skipped.diagrams += r.skipped ?? 0;
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
        const r = await bulkImportSettings(opts.newEndpoint, newToken, chunk);
        // Settings server returns { imported, rejected, skipped? } — count the
        // skipped (cross-user) and rejected (denylist) bucket together; both
        // mean "did not land on the new server".
        const settingsSkipped =
          ((r as { skipped?: number }).skipped ?? 0) + ((r as { rejected?: number }).rejected ?? 0);
        skipped.settings += settingsSkipped;
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
        const result = await bulkImportAttachment(opts.newEndpoint, newToken, {
          id: meta.id,
          blob,
          containerType: meta.containerType,
          containerId: meta.containerId,
          originalName: meta.originalName,
          mimeType: meta.mimeType,
        });
        if (result.kind === "skipped-cross-user") {
          skipped.attachments++;
          console.warn(
            `[migration] attachment ${meta.id} skipped — owned by another user on the new server`,
          );
        }
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

      const anySkipped =
        skipped.folders +
          skipped.notes +
          skipped.diagrams +
          skipped.settings +
          skipped.attachments >
        0;
      setState({
        kind: "done",
        mode: "push",
        skipped: anySkipped ? skipped : undefined,
      });
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
    localCounts,
    startPush,
    startReset,
    submitPasswordLogin,
    submitOidcLogin,
    cancelOidc,
    regenerateAndContinue,
    retry,
    cancel,
    close,
  };
}
