import crypto from "node:crypto";
import fs from "node:fs";
import * as Y from "yjs";
import { syncVerbose, syncWarn, syncError, logAuthSignedOut } from "./sync-logger.mjs";
import { PULL_INTERVAL_MS, DISK_RECONCILE_INTERVAL_MS } from "./sync-intervals.mjs";

const DEFAULT_ENDPOINT = "localhost:50051";

/**
 * Map common loopback spellings to one form so session checks survive harmless URL edits
 * (e.g. localhost vs 127.0.0.1, optional http(s) prefix).
 */
function canonicalHostPortForSession(host, port) {
  const h = String(host).toLowerCase();
  if (h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "0:0:0:0:0:0:0:1") {
    return `localhost:${port}`;
  }
  return `${h}:${port}`;
}

/**
 * Normalize stored vs current gRPC targets for equality (trim, scheme, loopback aliases).
 */
function canonicalBackendEndpointForSession(raw) {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) {
    return "";
  }
  const lower = t.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    try {
      const u = new URL(lower);
      const port = u.port || (u.protocol === "https:" ? "443" : "80");
      return canonicalHostPortForSession(u.hostname, port);
    } catch {
      return lower;
    }
  }
  const bracket = lower.match(/^\[([0-9a-f:]+)\]:(\d+)$/);
  if (bracket) {
    const inner = bracket[1];
    if (inner === "::1" || inner === "0:0:0:0:0:0:0:1") {
      return `localhost:${bracket[2]}`;
    }
    return `${inner}:${bracket[2]}`;
  }
  const lastColon = lower.lastIndexOf(":");
  if (lastColon > 0) {
    const host = lower.slice(0, lastColon);
    const port = lower.slice(lastColon + 1);
    if (/^\d{1,5}$/.test(port)) {
      const n = Number(port);
      if (n >= 1 && n <= 65535) {
        return canonicalHostPortForSession(host, port);
      }
    }
  }
  return lower;
}

export class SyncService {
  constructor({ metadataStore, workspaceService, backendClient, ydocManager }) {
    this.metadataStore = metadataStore;
    this.workspaceService = workspaceService;
    this.backendClient = backendClient;
    this.ydocManager = ydocManager;
    this.sendRemoteCrdtUpdate = null; // set externally by main.mjs
    this.sendCrdtStateReset = null; // set externally by main.mjs
    this.sendSyncStatus = null; // set externally by main.mjs
    this.sendWorkspaceChanged = null; // set externally by main.mjs
    this.activeNoteId = null; // set by renderer via IPC when a note is open in the editor
    this.syncTimeout = null;
    this.syncInFlight = null;
    /** @type {number} epoch ms — skip pull until this far in the future when idle */
    this.lastPullAtMs = 0;
    this.backgroundMaintenanceTimer = null;
  }

  setActiveNoteId(noteId) {
    this.activeNoteId = noteId || null;
  }

  async initialize() {
    if (!this.metadataStore.getSetting("clientId")) {
      this.metadataStore.setSetting("clientId", crypto.randomUUID());
    }

    if (this.metadataStore.getSetting("backendEndpoint", undefined) === undefined) {
      this.metadataStore.setSetting("backendEndpoint", DEFAULT_ENDPOINT);
    }

    if (this.metadataStore.getSetting("backendReachable", undefined) === undefined) {
      this.metadataStore.setSetting("backendReachable", false);
    }

    if (this.metadataStore.getSetting("authStatus", undefined) === undefined) {
      this.metadataStore.setSetting("authStatus", "signed_out");
    }

    if (this.metadataStore.getSetting("authProviders", undefined) === undefined) {
      this.metadataStore.setSetting("authProviders", []);
    }

    this.workspaceService.onWorkspaceDirty((diskRelPaths) => {
      this.sendWorkspaceChanged?.(diskRelPaths);
      if (this.syncEnabled()) {
        this.scheduleSync();
      }
    });

    this.startBackgroundMaintenance();
  }

  startBackgroundMaintenance() {
    if (this.backgroundMaintenanceTimer) {
      clearInterval(this.backgroundMaintenanceTimer);
    }
    this.backgroundMaintenanceTimer = setInterval(() => {
      void this.runPeriodicMaintenance();
    }, DISK_RECONCILE_INTERVAL_MS);
  }

  async runPeriodicMaintenance() {
    try {
      const touched = await this.workspaceService.reconcileDiskFromHashes();
      if (touched) {
        syncVerbose("runPeriodicMaintenance: disk reconcile found changes");
        this.sendWorkspaceChanged?.();
      }
    } catch (error) {
      syncError("runPeriodicMaintenance: disk reconcile failed", error);
    }
    if (this.syncEnabled()) {
      await this.syncInBackground();
    }
  }

  hasPendingSyncWork() {
    const dirty = this.metadataStore.listDirtyNotes?.() ?? [];
    const deletedDirty = this.metadataStore.listDeletedDirtyNotes?.() ?? [];
    const attachments = this.metadataStore.listPendingAttachments?.() ?? [];
    return dirty.length + deletedDirty.length + attachments.length > 0;
  }

  syncEnabled() {
    return (
      this.metadataStore.getSetting("backendReachable", false) &&
      this.metadataStore.getSetting("authStatus", "signed_out") === "authenticated"
    );
  }

  /**
   * After password/OIDC sign-in, ensure local notes are queued for upload.
   * Notes that were previously clean (dirty=0) are otherwise skipped by sync.
   */
  markLocalNotesDirtyForUploadAfterSignIn() {
    const before = this.metadataStore.listDirtyNotes?.()?.length ?? 0;
    this.metadataStore.markAllActiveNotesDirty();
    const after = this.metadataStore.listDirtyNotes?.()?.length ?? 0;
    syncVerbose("markAllActiveNotesDirty after sign-in", {
      dirtyNotesBefore: before,
      dirtyNotesAfter: after,
    });
  }

  scheduleSync() {
    if (!this.syncEnabled()) {
      syncVerbose("scheduleSync skipped (syncEnabled=false)", {
        backendReachable: this.metadataStore.getSetting("backendReachable", false),
        authStatus: this.metadataStore.getSetting("authStatus", "signed_out"),
      });
      return;
    }

    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }

    syncVerbose("scheduleSync: debounced sync in 1200ms");
    this.syncTimeout = setTimeout(() => {
      void this.syncInBackground();
    }, 1200);
  }

  endpoint() {
    const raw = this.metadataStore.getSetting("backendEndpoint", DEFAULT_ENDPOINT);
    if (typeof raw !== "string") {
      return DEFAULT_ENDPOINT;
    }
    const trimmed = raw.trim();
    return trimmed || DEFAULT_ENDPOINT;
  }

  backendConfig(endpoint = this.endpoint()) {
    return {
      endpoint,
      clientId: this.metadataStore.getSetting("clientId", "desktop-client"),
      backendReachable: this.metadataStore.getSetting("backendReachable", false),
      authStatus: this.metadataStore.getSetting("authStatus", "signed_out"),
      authProviders: this.metadataStore.getSetting("authProviders", []),
      authenticatedUserId: this.metadataStore.getSetting("authenticatedUserId", undefined),
      authenticatedEmail: this.metadataStore.getSetting("authenticatedEmail", undefined),
      authenticatedDisplayName: this.metadataStore.getSetting(
        "authenticatedDisplayName",
        undefined,
      ),
      authenticatedIsAdmin: this.metadataStore.getSetting("authenticatedIsAdmin", undefined),
      tokenExpiresAtUnix: this.metadataStore.getSetting("tokenExpiresAtUnix", undefined),
    };
  }

  setReachability(reachable) {
    this.metadataStore.setSetting("backendReachable", reachable);
  }

  setAuthProviders(providers) {
    this.metadataStore.setSetting("authProviders", providers ?? []);
  }

  clearAuthenticatedIdentity() {
    this.metadataStore.deleteSetting("authenticatedUserId");
    this.metadataStore.deleteSetting("authenticatedEmail");
    this.metadataStore.deleteSetting("authenticatedDisplayName");
    this.metadataStore.deleteSetting("authenticatedIsAdmin");
    this.metadataStore.deleteSetting("workspaceName");
  }

  clearSavedSession() {
    this.metadataStore.deleteSetting("accessToken");
    this.metadataStore.deleteSetting("refreshToken");
    this.metadataStore.deleteSetting("tokenExpiresAtUnix");
    this.metadataStore.deleteSetting("authSessionEndpoint");
    this.clearAuthenticatedIdentity();
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.preserveSession]
   * @param {string} [options.reason] machine-readable slug for logs
   * @param {Record<string, unknown>} [options.detail] extra context (endpoint, grpc code, etc.)
   */
  markSignedOut(options = {}) {
    const preserveSession = options.preserveSession === true;
    const reason = typeof options.reason === "string" ? options.reason : "unspecified";
    const detail = options.detail && typeof options.detail === "object" ? options.detail : {};

    // Capture call stack so we can always trace what triggered the sign-out
    const callStack =
      new Error().stack
        ?.split("\n")
        .slice(1, 5)
        .map((l) => l.trim())
        .join(" <- ") ?? "";

    logAuthSignedOut(reason, {
      preserveSession,
      clearedRefreshToken: !preserveSession,
      endpoint: this.endpoint(),
      hasAccessToken: Boolean(this.metadataStore.getSetting("accessToken", "")),
      hasRefreshToken: Boolean(this.metadataStore.getSetting("refreshToken", "")),
      authSessionEndpoint: this.metadataStore.getSetting("authSessionEndpoint", ""),
      callStack,
      ...detail,
    });

    this.metadataStore.setSetting("authStatus", "signed_out");
    if (preserveSession) {
      this.clearAuthenticatedIdentity();
    } else {
      this.clearSavedSession();
    }
    return this.backendConfig();
  }

  markAuthError() {
    const callStack =
      new Error().stack
        ?.split("\n")
        .slice(1, 5)
        .map((l) => l.trim())
        .join(" <- ") ?? "";
    logAuthSignedOut("auth_error", {
      endpoint: this.endpoint(),
      hasAccessToken: Boolean(this.metadataStore.getSetting("accessToken", "")),
      hasRefreshToken: Boolean(this.metadataStore.getSetting("refreshToken", "")),
      callStack,
    });
    this.metadataStore.setSetting("authStatus", "error");
    this.clearAuthenticatedIdentity();
    return this.backendConfig();
  }

  storeAuthenticatedSession(session, endpoint = this.endpoint()) {
    if (session.tokens?.accessToken) {
      this.metadataStore.setSetting("accessToken", session.tokens.accessToken);
    }
    if (session.tokens?.refreshToken) {
      this.metadataStore.setSetting("refreshToken", session.tokens.refreshToken);
    }
    if (session.tokens?.expiresAtUnix) {
      this.metadataStore.setSetting("tokenExpiresAtUnix", Number(session.tokens.expiresAtUnix));
    }

    this.metadataStore.setSetting("authSessionEndpoint", endpoint);
    const resolvedUserId = session.userId ?? session.user_id;
    this.metadataStore.setSetting("authenticatedUserId", resolvedUserId);
    this.metadataStore.setSetting("authenticatedEmail", session.email ?? "");
    this.metadataStore.setSetting("authenticatedDisplayName", session.displayName ?? "");
    this.metadataStore.setSetting("authenticatedIsAdmin", Boolean(session.isAdmin));
    this.metadataStore.setSetting(
      "workspaceName",
      session.displayName ?? this.workspaceService.getWorkspaceProfile().name,
    );
    this.metadataStore.setSetting("authStatus", "authenticated");
    this.setReachability(true);
    if (!resolvedUserId) {
      syncWarn("storeAuthenticatedSession: missing userId (check gRPC SessionResponse mapping)", {
        endpoint,
        sessionKeys: session && typeof session === "object" ? Object.keys(session) : [],
      });
    } else {
      syncVerbose("storeAuthenticatedSession", {
        endpoint,
        userId: resolvedUserId,
        hasAccessToken: Boolean(session.tokens?.accessToken),
      });
    }
    return this.backendConfig(endpoint);
  }

  hasSessionForEndpoint(endpoint = this.endpoint()) {
    const accessToken = this.metadataStore.getSetting("accessToken", "");
    const refreshToken = this.metadataStore.getSetting("refreshToken", "");
    if (!accessToken && !refreshToken) {
      return false;
    }
    const sessionEndpoint = this.metadataStore.getSetting("authSessionEndpoint", "");
    // Upgrades before authSessionEndpoint existed: tokens are present but host was never stored.
    if (!sessionEndpoint) {
      return true;
    }
    return (
      canonicalBackendEndpointForSession(sessionEndpoint) ===
      canonicalBackendEndpointForSession(endpoint)
    );
  }

  disconnectBackend(
    endpoint = this.endpoint(),
    { reason = "backend_unreachable_or_cleared", detail = {} } = {},
  ) {
    logAuthSignedOut(reason, {
      endpoint,
      tokensPreserved: true,
      clearedProfileOnly: true,
      backendReachableSetTo: false,
      ...detail,
    });
    this.setReachability(false);
    this.metadataStore.setSetting("authStatus", "signed_out");
    this.clearAuthenticatedIdentity();
    return this.backendConfig(endpoint);
  }

  clearBackendStateForEndpoint(nextEndpoint) {
    const previousEndpoint = this.endpoint();
    const nextTrimmed = typeof nextEndpoint === "string" ? nextEndpoint.trim() : "";
    const endpointChanged =
      canonicalBackendEndpointForSession(previousEndpoint) !==
      canonicalBackendEndpointForSession(nextTrimmed);
    if (endpointChanged) {
      this.clearSavedSession();
      this.setAuthProviders([]);
    }
    logAuthSignedOut("backend_endpoint_changed", {
      previousEndpoint,
      nextEndpoint,
      clearedSavedSession: endpointChanged,
    });
    this.setReachability(false);
    this.metadataStore.setSetting("authStatus", "signed_out");
    return this.backendConfig(nextEndpoint);
  }

  async discoverAuthProviders(endpoint = this.endpoint()) {
    const response = await this.backendClient.listAuthProviders(endpoint);
    const providers = response.providers ?? [];
    this.setAuthProviders(providers);
    return providers;
  }

  async validateSavedSession(endpoint = this.endpoint()) {
    if (!this.hasSessionForEndpoint(endpoint)) {
      return this.markSignedOut({
        reason: "no_stored_session_for_endpoint",
        detail: { endpoint },
      });
    }

    const accessToken = this.metadataStore.getSetting("accessToken", "");
    if (!accessToken) {
      syncVerbose("validateSavedSession: access token missing, trying token refresh", { endpoint });
      return this.tryRefreshTokens(endpoint);
    }

    this.metadataStore.setSetting("authStatus", "authenticating");
    try {
      const session = await this.backendClient.getCurrentSessionAt(endpoint, accessToken);
      const merged = {
        ...session,
        tokens: {
          accessToken: this.metadataStore.getSetting("accessToken", ""),
          refreshToken: this.metadataStore.getSetting("refreshToken", ""),
          expiresAtUnix: this.metadataStore.getSetting("tokenExpiresAtUnix", 0),
        },
      };
      const backend = this.storeAuthenticatedSession(merged, endpoint);
      syncVerbose("validateSavedSession: restored session (sync on dirty / pull timer only)");
      return backend;
    } catch (error) {
      if (this.backendClient.isUnauthenticatedError(error)) {
        syncVerbose("validateSavedSession: unauthenticated, trying token refresh", {
          endpoint,
          grpcCode: error?.code,
          message: error?.message,
        });
        return this.tryRefreshTokens(endpoint);
      }
      syncWarn("validateSavedSession: failed", { message: error?.message, code: error?.code });
      return this.markAuthError();
    }
  }

  async tryRefreshTokens(endpoint = this.endpoint()) {
    const refreshToken = this.metadataStore.getSetting("refreshToken", "");
    if (!refreshToken) {
      return this.markSignedOut({
        reason: "refresh_token_missing",
        detail: { endpoint },
      });
    }

    try {
      const session = await this.backendClient.refreshTokensAt(endpoint, refreshToken);
      const backend = this.storeAuthenticatedSession(session, endpoint);
      syncVerbose("tryRefreshTokens: success (sync on dirty / pull timer only)");
      return backend;
    } catch (error) {
      syncVerbose("tryRefreshTokens: failed, signing out");
      return this.markSignedOut({
        reason: "token_refresh_failed",
        detail: {
          endpoint,
          message: error?.message,
          code: error?.code,
        },
      });
    }
  }

  async refreshBackendStatus() {
    const endpoint = this.endpoint();
    if (!endpoint) {
      return this.disconnectBackend("", {
        reason: "missing_backend_endpoint",
        detail: { hint: "backend URL is empty after trim" },
      });
    }

    try {
      await this.backendClient.checkConnection(endpoint);
      this.setReachability(true);
    } catch (error) {
      return this.disconnectBackend(endpoint, {
        reason: "backend_connection_failed",
        detail: { message: error?.message, code: error?.code },
      });
    }

    try {
      await this.discoverAuthProviders(endpoint);
    } catch {
      this.setAuthProviders([]);
      return this.markAuthError();
    }

    if (!this.hasSessionForEndpoint(endpoint)) {
      return this.markSignedOut({
        reason: "session_not_valid_for_endpoint",
        detail: {
          endpoint,
          hint: "access token missing or saved for a different backend host",
        },
      });
    }

    return this.validateSavedSession(endpoint);
  }

  async connectBackend() {
    return this.refreshBackendStatus();
  }

  async loginWithPassword({ email, password, totpCode = "" }) {
    const endpoint = this.endpoint();
    if (!endpoint) {
      throw new Error("Set a backend URL first");
    }

    this.metadataStore.setSetting("authStatus", "authenticating");
    await this.backendClient.checkConnection(endpoint);
    this.setReachability(true);
    await this.discoverAuthProviders(endpoint);

    const session = await this.backendClient.loginWithPasswordAt(endpoint, {
      email,
      password,
      totpCode,
      clientId: this.metadataStore.getSetting("clientId", "desktop-client"),
    });

    const backend = this.storeAuthenticatedSession(session, endpoint);
    syncVerbose("loginWithPassword: session stored, queuing sync", {
      endpoint,
      userId: backend.authenticatedUserId,
      email: backend.authenticatedEmail,
    });
    this.markLocalNotesDirtyForUploadAfterSignIn();
    void this.syncInBackground();
    return backend;
  }

  async startOidcLogin(providerId, redirectUri) {
    const endpoint = this.endpoint();
    if (!endpoint) {
      throw new Error("Set a backend URL first");
    }

    this.metadataStore.setSetting("authStatus", "authenticating");
    await this.backendClient.checkConnection(endpoint);
    this.setReachability(true);
    await this.discoverAuthProviders(endpoint);

    return this.backendClient.startOidcAt(endpoint, {
      providerId,
      redirectUri,
      clientId: this.metadataStore.getSetting("clientId", "desktop-client"),
      isAdmin: false,
    });
  }

  async completeOidcLogin({ providerId, redirectUri, state, code }) {
    const endpoint = this.endpoint();
    if (!endpoint) {
      throw new Error("Set a backend URL first");
    }

    const session = await this.backendClient.completeOidcAt(endpoint, {
      providerId,
      redirectUri,
      state,
      code,
      clientId: this.metadataStore.getSetting("clientId", "desktop-client"),
    });

    const backend = this.storeAuthenticatedSession(session, endpoint);
    syncVerbose("completeOidcLogin: session stored, queuing sync", {
      endpoint,
      userId: backend.authenticatedUserId,
    });
    this.markLocalNotesDirtyForUploadAfterSignIn();
    void this.syncInBackground();
    return backend;
  }

  signOut() {
    return this.markSignedOut({ reason: "user_sign_out" });
  }

  async handleAuthenticatedCall(action) {
    try {
      return await action();
    } catch (error) {
      if (this.backendClient.isUnauthenticatedError(error)) {
        // Try refreshing the token before giving up. The access token has a
        // 1-hour expiry and backend restarts can also invalidate tokens.
        syncVerbose("handleAuthenticatedCall: auth error, attempting token refresh", {
          grpcCode: error?.code,
        });
        const refreshed = await this.tryRefreshTokens();
        if (refreshed && this.metadataStore.getSetting("authStatus") === "authenticated") {
          try {
            return await action();
          } catch (retryError) {
            if (this.backendClient.isUnauthenticatedError(retryError)) {
              syncWarn("handleAuthenticatedCall: still unauthenticated after refresh, signing out");
              this.markSignedOut({
                reason: "grpc_unauthenticated_after_refresh",
                detail: {
                  grpcCode: retryError?.code,
                  message: retryError?.message,
                },
              });
              return null;
            }
            throw retryError;
          }
        }
        return null;
      }
      throw error;
    }
  }

  async syncPendingAttachments() {
    if (!this.syncEnabled()) return;

    const pending = this.metadataStore.listPendingAttachments();
    if (pending.length === 0) return;

    const endpoint = this.endpoint();
    const accessToken = this.metadataStore.getSetting("accessToken", "");
    const userId = this.metadataStore.getSetting("authenticatedUserId", "");
    if (!userId) return;

    for (const item of pending) {
      if (item.retries >= 5) {
        console.error(`Giving up on pending attachment ${item.id} after ${item.retries} retries`);
        continue;
      }

      try {
        if (!fs.existsSync(item.local_path)) {
          this.metadataStore.deletePendingAttachment(item.id);
          continue;
        }

        const buffer = fs.readFileSync(item.local_path);
        const result = await this.backendClient.uploadAttachment(endpoint, accessToken, {
          buffer,
          fileName: item.file_name,
          mimeType: item.mime_type,
          documentId: item.document_id,
        });

        // Rewrite image src in the Y.Doc from pending URL to real URL
        const pendingUrl = `/api/attachments/pending/${item.id}/content`;
        const realUrl = result.contentUrl;
        this.ydocManager.replaceImageSrc(item.document_id, pendingUrl, realUrl);

        // Materialize markdown and write .md file
        const markdown = await this.ydocManager.materializeMarkdown(item.document_id);
        const noteRow = this.metadataStore.getNoteById(item.document_id);
        if (noteRow) {
          await this.workspaceService.writeMarkdownFile(noteRow.relative_path, markdown);
          this.workspaceService.scheduleDirtyCallback({ diskRelPath: noteRow.relative_path });
        }

        // Mark dirty so CRDT update syncs
        this.metadataStore.markNoteDirty(item.document_id);

        // Send remote update to renderer if note is open
        const crdtUpdate = this.ydocManager.getFullState(item.document_id);
        this.sendRemoteCrdtUpdate?.(item.document_id, crdtUpdate);

        // Clean up local file and metadata
        try {
          fs.unlinkSync(item.local_path);
        } catch {}
        this.metadataStore.deletePendingAttachment(item.id);
      } catch (err) {
        console.error(
          `Failed to sync pending attachment ${item.id} (retry ${item.retries}):`,
          err?.message ?? err,
        );
        this.metadataStore.incrementPendingAttachmentRetries(item.id);
      }
    }
  }

  async fullSync() {
    return this.syncNow({ forceFull: true });
  }

  async syncInBackground() {
    syncVerbose("syncInBackground: start");
    try {
      await this.syncNow();
      syncVerbose("syncInBackground: finished OK");
    } catch (error) {
      this.handleBackgroundSyncError(error);
    }
  }

  async syncNow(options = {}) {
    const forceFull = Boolean(options?.forceFull);
    if (this.syncInFlight) {
      syncVerbose("syncNow: coalesced (sync already in flight)");
      return this.syncInFlight;
    }

    syncVerbose("syncNow: starting new run", { forceFull });
    this.syncInFlight = this.runSyncNow({ forceFull }).finally(() => {
      this.syncInFlight = null;
    });

    return this.syncInFlight;
  }

  async searchNotes(query) {
    const localNotes = await this.workspaceService.searchNotes(query);
    if (!this.syncEnabled()) {
      return localNotes;
    }

    const remoteResults = await this.handleAuthenticatedCall(() =>
      this.backendClient.searchDocuments({
        query,
        limit: 20,
      }),
    );

    if (!remoteResults) {
      return localNotes;
    }

    const localById = new Map(localNotes.map((note) => [note.id, note]));
    for (const result of remoteResults.results ?? []) {
      if (!localById.has(result.documentId)) {
        localById.set(result.documentId, {
          id: result.documentId,
          title: result.title,
          path: result.path,
          preview: result.snippet,
          markdown: result.snippet,
          plainText: result.snippet,
          updatedAt: new Date().toISOString(),
          acceptedRevision: 0,
          deleted: false,
          syncState: "idle",
        });
      }
    }

    return Array.from(localById.values());
  }

  async getSnapshot() {
    const workspace = this.workspaceService.getWorkspaceProfile();
    const [notes, folders] = await Promise.all([
      this.workspaceService.listNotes(),
      this.workspaceService.listFolders(),
    ]);

    return {
      workspace,
      backend: this.backendConfig(),
      notes,
      folders,
    };
  }

  async pushPendingNotes(clientId) {
    const dirtyRows = this.metadataStore.listDirtyNotes?.() ?? [];
    const deletedRows = this.metadataStore.listDeletedDirtyNotes?.() ?? [];
    const pendingRows = [...dirtyRows, ...deletedRows].filter(
      (row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index,
    );

    syncVerbose("pushPendingNotes", {
      clientId,
      dirtyCount: dirtyRows.length,
      deletedDirtyCount: deletedRows.length,
      pendingUnique: pendingRows.length,
      noteIds: pendingRows.map((r) => r.id).slice(0, 15),
    });

    let noteListMayNeedRefresh = false;
    const pushedNoteIds = new Set();

    for (const row of pendingRows) {
      const noteId = row.id;
      const deleted = Boolean(row.deleted);
      const crdtUpdate = deleted
        ? this.ydocManager.getFullState(noteId)
        : this.ydocManager.getUpdate(noteId, null);
      const clientStateVector = deleted ? undefined : this.ydocManager.getStateVector(noteId);
      const response = await this.handleAuthenticatedCall(() =>
        this.backendClient.pushDocumentUpdate({
          clientId,
          documentId: noteId,
          path: row.relative_path,
          deleted,
          pinned: Boolean(row.pinned),
          crdtUpdate,
          clientStateVector,
        }),
      );
      if (!response) {
        syncWarn("pushPendingNotes: push returned no response (auth cleared or RPC skipped)", {
          noteId,
          path: row.relative_path,
          deleted,
        });
        continue;
      }

      noteListMayNeedRefresh = true;

      syncVerbose("pushPendingNotes: pushed OK", {
        noteId,
        path: row.relative_path,
        serverSeq: response.serverSeq,
        deleted,
      });

      if (deleted) {
        this.metadataStore.purgeNote(noteId);
        this.ydocManager?.release?.(noteId);
        continue;
      }

      if (response.serverDelta?.length > 0) {
        this.ydocManager.applyUpdate(noteId, response.serverDelta);
        this.sendRemoteCrdtUpdate?.(noteId, response.serverDelta);
        const markdown = await this.ydocManager.materializeMarkdown(noteId);
        const noteRow = this.metadataStore.getNoteById(noteId);
        if (noteRow) {
          await this.workspaceService.writeMarkdownFile(noteRow.relative_path, markdown);
        }
      }

      if (this.metadataStore.updateNoteServerSeq) {
        this.metadataStore.updateNoteServerSeq(noteId, response.serverSeq);
      } else {
        this.metadataStore.updateNoteRevision(noteId, response.serverSeq);
      }

      this.workspaceService.refreshNoteDiskSnapshot(noteId);
      pushedNoteIds.add(noteId);
    }

    if (noteListMayNeedRefresh) {
      this.workspaceService.scheduleDirtyCallback();
    }

    return pushedNoteIds;
  }

  async pullRemoteEvents(clientId, { skipNoteIds = new Set() } = {}) {
    // Merge the actively-edited note into the skip set so we never
    // destructively reset the note the user is looking at.
    if (this.activeNoteId) {
      skipNoteIds = new Set(skipNoteIds);
      skipNoteIds.add(this.activeNoteId);
    }

    const sinceServerSeq = this.metadataStore.getSetting("lastServerSeq", 0);
    syncVerbose("pullRemoteEvents: request", { clientId, sinceServerSeq });
    const response = await this.handleAuthenticatedCall(() =>
      this.backendClient.pullDocumentEvents({
        clientId,
        sinceServerSeq,
      }),
    );
    if (!response) {
      syncWarn("pullRemoteEvents: no response (auth error or empty)");
      return;
    }

    const docs = response.documents ?? [];
    syncVerbose("pullRemoteEvents: response", {
      documentCount: docs.length,
      latestServerSeq: response.latestServerSeq,
    });

    // Track the lowest serverSeq of any note skipped because it is
    // actively open in the editor. We must not advance lastServerSeq
    // past this value, otherwise the server won't re-send the note on
    // the next pull and its remote changes would be silently lost.
    let minActiveSkippedSeq = Infinity;

    for (const document of docs) {
      if (document.deleted) {
        const existing = this.metadataStore.getNoteById(document.documentId);
        if (existing) {
          this.metadataStore.purgeNote(document.documentId);
          this.ydocManager?.release?.(document.documentId);
        }
        continue;
      }

      if (skipNoteIds.has(document.documentId)) {
        syncVerbose("pullRemoteEvents: skipping note (recently pushed or actively edited)", {
          noteId: document.documentId,
          serverSeq: document.serverSeq,
          isActiveNote: document.documentId === this.activeNoteId,
        });
        // Only regress lastServerSeq for the active note. Recently-pushed
        // notes already received server changes via the push response's
        // serverDelta, so they don't need to be re-pulled.
        if (document.documentId === this.activeNoteId) {
          minActiveSkippedSeq = Math.min(minActiveSkippedSeq, document.serverSeq);
        }
        continue;
      }

      if (document.crdtState?.length > 0) {
        // Skip destructive reset for notes with pending local changes.
        // The local edits will be pushed on the next sync cycle and
        // reconciled via the push response's serverDelta, preserving
        // cursor position and undo history.
        const existing = this.metadataStore.getNoteById(document.documentId);
        if (existing?.dirty) {
          syncVerbose("pullRemoteEvents: skipping dirty note", {
            noteId: document.documentId,
            serverSeq: document.serverSeq,
          });
          continue;
        }

        // Replace rather than merge: the server's CRDT state may have been
        // bootstrapped independently (different client IDs), so merging
        // would duplicate content. Destroy and rebuild from server state.
        this.ydocManager.replaceFromState(document.documentId, document.crdtState);
        const markdown = await this.ydocManager.materializeMarkdown(document.documentId);
        await this.workspaceService.writeRemoteNote({
          id: document.documentId,
          title: pathFromMarkdownFallback(markdown, document.path),
          path: document.path,
          markdown,
          serverSeq: document.serverSeq,
          acceptedRevision: document.serverSeq,
          pinned: document.pinned ? 1 : 0,
        });
        // Signal renderer to re-initialize its Y.Doc from scratch
        this.sendCrdtStateReset?.(document.documentId);
      }
    }

    // Don't advance past the active note's serverSeq so the server
    // re-sends it on the next pull when it is no longer active.
    const serverLatest = Number(response.latestServerSeq ?? sinceServerSeq);
    const effectiveSeq =
      minActiveSkippedSeq === Infinity
        ? serverLatest
        : Math.min(serverLatest, minActiveSkippedSeq - 1);
    this.metadataStore.setSetting("lastServerSeq", Math.max(effectiveSeq, sinceServerSeq));

    if (docs.length > 0) {
      this.workspaceService.scheduleDirtyCallback();
    }
  }

  async runSyncNow({ forceFull = false } = {}) {
    if (!this.syncEnabled()) {
      syncVerbose("runSyncNow: sync not enabled; calling refreshBackendStatus", {
        backendReachable: this.metadataStore.getSetting("backendReachable", false),
        authStatus: this.metadataStore.getSetting("authStatus", "signed_out"),
      });
      await this.refreshBackendStatus();
      if (!this.syncEnabled()) {
        syncVerbose("runSyncNow: still not enabled after refresh; aborting", {
          backendReachable: this.metadataStore.getSetting("backendReachable", false),
          authStatus: this.metadataStore.getSetting("authStatus", "signed_out"),
          hasAccessToken: Boolean(this.metadataStore.getSetting("accessToken", "")),
        });
        return this.getSnapshot();
      }
    }

    const pending = this.hasPendingSyncWork();
    const pullDue = forceFull || Date.now() - this.lastPullAtMs >= PULL_INTERVAL_MS;

    if (!pending && !pullDue) {
      syncVerbose("runSyncNow: skip (no local work, pull not due yet)", {
        msUntilPull: Math.max(0, PULL_INTERVAL_MS - (Date.now() - this.lastPullAtMs)),
      });
      return this.getSnapshot();
    }

    this.sendSyncStatus?.("syncing");
    syncVerbose("runSyncNow: syncing…", { pending, pullDue, forceFull });

    try {
      const clientId = this.metadataStore.getSetting("clientId");
      const userId = this.metadataStore.getSetting("authenticatedUserId");
      if (!userId) {
        syncWarn(
          "runSyncNow: abort — authenticatedUserId missing (session not stored correctly?)",
          {
            clientId,
            authStatus: this.metadataStore.getSetting("authStatus", "signed_out"),
          },
        );
        return this.getSnapshot();
      }

      let pushedNoteIds = new Set();
      if (pending) {
        pushedNoteIds = await this.pushPendingNotes(clientId);
      }

      const shouldPull = pullDue || pending;
      if (shouldPull) {
        await this.pullRemoteEvents(clientId, { skipNoteIds: pushedNoteIds });
        this.lastPullAtMs = Date.now();
      }

      if (pending) {
        await this.syncPendingAttachments();

        const remainingDirtyRows = [
          ...(this.metadataStore.listDirtyNotes?.() ?? []),
          ...(this.metadataStore.listDeletedDirtyNotes?.() ?? []),
        ];
        if (remainingDirtyRows.length > 0) {
          syncVerbose("runSyncNow: second push pass", {
            remainingDirty: remainingDirtyRows.length,
          });
          await this.pushPendingNotes(clientId);
        }
      }

      this.sendSyncStatus?.("synced");
      syncVerbose("runSyncNow: complete");
      return this.getSnapshot();
    } catch (error) {
      syncError("runSyncNow: failed", error);
      this.handleSyncTransportError(error);
      this.sendSyncStatus?.("error");
      throw error;
    }
  }

  handleBackgroundSyncError(error) {
    this.handleSyncTransportError(error);
    syncError("syncInBackground: caught error", error);
  }

  handleSyncTransportError(error) {
    if (this.isConnectivityError(error)) {
      this.setReachability(false);
    }
  }

  isConnectivityError(error) {
    if (!error) {
      return false;
    }

    if (error.code === 14) {
      return true;
    }

    const message = String(error.message ?? error);
    return message.includes("ECONNREFUSED") || message.includes("UNAVAILABLE");
  }
}

function pathFromMarkdownFallback(markdown, relativePath) {
  const heading = markdown.split("\n").find((line) => line.startsWith("# "));
  if (heading) return heading.replace(/^#\s+/, "").trim();
  return relativePath.split("/").pop()?.replace(/\.md$/i, "") || "Untitled note";
}
