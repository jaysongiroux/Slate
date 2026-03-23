import crypto from "node:crypto";
import fs from "node:fs";

const DEFAULT_ENDPOINT = "localhost:50051";

export class SyncService {
  constructor({ metadataStore, workspaceService, backendClient, ydocManager }) {
    this.metadataStore = metadataStore;
    this.workspaceService = workspaceService;
    this.backendClient = backendClient;
    this.ydocManager = ydocManager;
    this.sendRemoteCrdtUpdate = null; // set externally by main.mjs
    this.sendSyncStatus = null; // set externally by main.mjs
    this.sendWorkspaceChanged = null; // set externally by main.mjs
    this.syncTimeout = null;
    this.syncInFlight = null;
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

    this.workspaceService.onWorkspaceDirty(() => {
      this.sendWorkspaceChanged?.();
      if (this.syncEnabled()) {
        this.scheduleSync();
      }
    });
  }

  syncEnabled() {
    return (
      this.metadataStore.getSetting("backendReachable", false) &&
      this.metadataStore.getSetting("authStatus", "signed_out") === "authenticated"
    );
  }

  scheduleSync() {
    if (!this.syncEnabled()) {
      return;
    }

    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }

    this.syncTimeout = setTimeout(() => {
      void this.syncInBackground();
    }, 1200);
  }

  endpoint() {
    return this.metadataStore.getSetting("backendEndpoint", DEFAULT_ENDPOINT);
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
      authenticatedDisplayName: this.metadataStore.getSetting("authenticatedDisplayName", undefined),
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

  markSignedOut({ preserveSession = false } = {}) {
    this.metadataStore.setSetting("authStatus", "signed_out");
    if (preserveSession) {
      this.clearAuthenticatedIdentity();
    } else {
      this.clearSavedSession();
    }
    return this.backendConfig();
  }

  markAuthError() {
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
    this.metadataStore.setSetting("authenticatedUserId", session.userId);
    this.metadataStore.setSetting("authenticatedEmail", session.email ?? "");
    this.metadataStore.setSetting("authenticatedDisplayName", session.displayName ?? "");
    this.metadataStore.setSetting("authenticatedIsAdmin", Boolean(session.isAdmin));
    this.metadataStore.setSetting(
      "workspaceName",
      session.displayName ?? this.workspaceService.getWorkspaceProfile().name,
    );
    this.metadataStore.setSetting("authStatus", "authenticated");
    this.setReachability(true);
    return this.backendConfig(endpoint);
  }

  hasSessionForEndpoint(endpoint = this.endpoint()) {
    const accessToken = this.metadataStore.getSetting("accessToken", "");
    const sessionEndpoint = this.metadataStore.getSetting("authSessionEndpoint", "");
    return Boolean(accessToken) && sessionEndpoint === endpoint;
  }

  disconnectBackend(endpoint = this.endpoint()) {
    this.setReachability(false);
    this.metadataStore.setSetting("authStatus", "signed_out");
    this.clearAuthenticatedIdentity();
    return this.backendConfig(endpoint);
  }

  clearBackendStateForEndpoint(nextEndpoint) {
    const previousEndpoint = this.endpoint();
    if (previousEndpoint !== nextEndpoint) {
      this.clearSavedSession();
      this.setAuthProviders([]);
    }
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
      return this.markSignedOut();
    }

    this.metadataStore.setSetting("authStatus", "authenticating");
    try {
      const session = await this.backendClient.getCurrentSessionAt(
        endpoint,
        this.metadataStore.getSetting("accessToken", ""),
      );
      const merged = {
        ...session,
        tokens: {
          accessToken: this.metadataStore.getSetting("accessToken", ""),
          refreshToken: this.metadataStore.getSetting("refreshToken", ""),
          expiresAtUnix: this.metadataStore.getSetting("tokenExpiresAtUnix", 0),
        },
      };
      const backend = this.storeAuthenticatedSession(merged, endpoint);
      void this.syncInBackground();
      return backend;
    } catch (error) {
      if (this.backendClient.isUnauthenticatedError(error)) {
        return this.tryRefreshTokens(endpoint);
      }
      return this.markAuthError();
    }
  }

  async tryRefreshTokens(endpoint = this.endpoint()) {
    const refreshToken = this.metadataStore.getSetting("refreshToken", "");
    if (!refreshToken) {
      return this.markSignedOut();
    }

    try {
      const session = await this.backendClient.refreshTokensAt(endpoint, refreshToken);
      const backend = this.storeAuthenticatedSession(session, endpoint);
      void this.syncInBackground();
      return backend;
    } catch {
      return this.markSignedOut();
    }
  }

  async refreshBackendStatus() {
    const endpoint = this.endpoint();
    if (!endpoint) {
      return this.disconnectBackend("");
    }

    try {
      await this.backendClient.checkConnection(endpoint);
      this.setReachability(true);
    } catch {
      return this.disconnectBackend(endpoint);
    }

    try {
      await this.discoverAuthProviders(endpoint);
    } catch {
      this.setAuthProviders([]);
      return this.markAuthError();
    }

    if (!this.hasSessionForEndpoint(endpoint)) {
      return this.markSignedOut();
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
    void this.syncInBackground();
    return backend;
  }

  signOut() {
    return this.markSignedOut();
  }

  async handleAuthenticatedCall(action) {
    try {
      return await action();
    } catch (error) {
      if (this.backendClient.isUnauthenticatedError(error)) {
        this.markSignedOut();
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
        console.error(`Failed to sync pending attachment ${item.id} (retry ${item.retries}):`, err?.message ?? err);
        this.metadataStore.incrementPendingAttachmentRetries(item.id);
      }
    }
  }

  async fullSync() {
    return this.syncNow();
  }

  async syncInBackground() {
    try {
      await this.syncNow();
    } catch (error) {
      this.handleBackgroundSyncError(error);
    }
  }

  async syncNow() {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.syncInFlight = this.runSyncNow().finally(() => {
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
          crdtUpdate,
          clientStateVector,
        }),
      );
      if (!response) continue;

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
    }
  }

  async pullRemoteEvents(clientId) {
    const sinceServerSeq = this.metadataStore.getSetting("lastServerSeq", 0);
    const response = await this.handleAuthenticatedCall(() =>
      this.backendClient.pullDocumentEvents({
        clientId,
        sinceServerSeq,
      }),
    );
    if (!response) return;

    for (const document of response.documents ?? []) {
      if (document.deleted) {
        const existing = this.metadataStore.getNoteById(document.documentId);
        if (existing) {
          this.metadataStore.purgeNote(document.documentId);
          this.ydocManager?.release?.(document.documentId);
        }
        continue;
      }

      if (document.crdtState?.length > 0) {
        this.ydocManager.applyUpdate(document.documentId, document.crdtState);
        this.ydocManager.persist?.(document.documentId);
        const markdown = await this.ydocManager.materializeMarkdown(document.documentId);
        await this.workspaceService.writeRemoteNote({
          id: document.documentId,
          title: pathFromMarkdownFallback(markdown, document.path),
          path: document.path,
          markdown,
          serverSeq: document.serverSeq,
          acceptedRevision: document.serverSeq,
        });
        this.sendRemoteCrdtUpdate?.(document.documentId, this.ydocManager.getFullState(document.documentId));
      }
    }

    this.metadataStore.setSetting("lastServerSeq", Number(response.latestServerSeq ?? sinceServerSeq));
  }

  async runSyncNow() {
    if (!this.syncEnabled()) {
      await this.refreshBackendStatus();
      if (!this.syncEnabled()) return this.getSnapshot();
    }

    this.sendSyncStatus?.("syncing");

    try {
      const clientId = this.metadataStore.getSetting("clientId");
      const userId = this.metadataStore.getSetting("authenticatedUserId");
      if (!userId) {
        return this.getSnapshot();
      }

      await this.pushPendingNotes(clientId);
      await this.pullRemoteEvents(clientId);
      await this.syncPendingAttachments();

      const remainingDirtyRows = [
        ...(this.metadataStore.listDirtyNotes?.() ?? []),
        ...(this.metadataStore.listDeletedDirtyNotes?.() ?? []),
      ];
      if (remainingDirtyRows.length > 0) {
        await this.pushPendingNotes(clientId);
      }

      this.sendSyncStatus?.("synced");
      return this.getSnapshot();
    } catch (error) {
      this.handleSyncTransportError(error);
      this.sendSyncStatus?.("error");
      throw error;
    }
  }

  handleBackgroundSyncError(error) {
    this.handleSyncTransportError(error);
    const message = error?.message ?? error;
    console.error("Background sync failed:", message);
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
