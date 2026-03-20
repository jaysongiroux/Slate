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
    this.syncTimeout = null;
    this._fullSyncRunning = false;
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
      void this.syncNow();
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
      authenticatedWorkspaceId: this.metadataStore.getSetting("authenticatedWorkspaceId", undefined),
      authenticatedEmail: this.metadataStore.getSetting("authenticatedEmail", undefined),
      authenticatedDisplayName: this.metadataStore.getSetting("authenticatedDisplayName", undefined),
      authenticatedWorkspaceName: this.metadataStore.getSetting("authenticatedWorkspaceName", undefined),
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
    this.metadataStore.deleteSetting("authenticatedWorkspaceId");
    this.metadataStore.deleteSetting("authenticatedEmail");
    this.metadataStore.deleteSetting("authenticatedDisplayName");
    this.metadataStore.deleteSetting("authenticatedWorkspaceName");
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
    this.metadataStore.setSetting("authenticatedWorkspaceId", session.workspaceId);
    this.metadataStore.setSetting("authenticatedEmail", session.email ?? "");
    this.metadataStore.setSetting("authenticatedDisplayName", session.displayName ?? "");
    this.metadataStore.setSetting("authenticatedWorkspaceName", session.workspaceName ?? "");
    this.metadataStore.setSetting("authenticatedIsAdmin", Boolean(session.isAdmin));
    this.metadataStore.setSetting(
      "workspaceName",
      session.workspaceName ?? this.workspaceService.getWorkspaceProfile().name,
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
      // Full sync on session restore (app open / reconnect)
      void this.fullSync();
      return backend;
    } catch (error) {
      if (this.backendClient.isUnauthenticatedError(error)) {
        return this.markSignedOut();
      }
      return this.markAuthError();
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
    void this.fullSync();
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
    void this.fullSync();
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
    const workspaceId = this.metadataStore.getSetting("authenticatedWorkspaceId", "");
    if (!workspaceId) return;

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
          workspaceId,
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

  /**
   * Full bidirectional sync: push ALL local notes to the server, then pull
   * ALL server notes (revision 0) to pick up anything missing locally.
   * Called on app open, login, and reconnect.
   */
  async fullSync() {
    if (this._fullSyncRunning) return this.getSnapshot();
    if (!this.syncEnabled()) {
      await this.refreshBackendStatus();
      if (!this.syncEnabled()) return this.getSnapshot();
    }
    this._fullSyncRunning = true;
    this.sendSyncStatus?.("syncing");
    try {
      return await this._doFullSync();
    } finally {
      this._fullSyncRunning = false;
      this.sendSyncStatus?.("synced");
    }
  }

  async _doFullSync() {
    const clientId = this.metadataStore.getSetting("clientId");
    const workspaceId = this.metadataStore.getSetting("authenticatedWorkspaceId");
    const ownerUserId = this.metadataStore.getSetting("authenticatedUserId");
    if (!workspaceId || !ownerUserId) {
      this.markSignedOut();
      return this.getSnapshot();
    }

    // 1a. Push deletions to the backend
    await this.syncDeletedNotes(clientId, workspaceId);

    // 1b. Push notes that are dirty or never synced (acceptedRevision 0)
    const allRows = this.metadataStore.listNotes();
    for (const row of allRows) {
      if (!row.dirty && row.accepted_revision > 0) continue;
      const noteId = row.id;
      // Ensure CRDT state exists (bootstrap from markdown if needed)
      if (!this.ydocManager.hasCrdtState(noteId)) {
        const markdown = await this.workspaceService.readNoteMarkdown(row.relative_path);
        if (markdown !== null && markdown !== undefined) {
          await this.ydocManager.bootstrapFromMarkdown(noteId, markdown);
        } else {
          continue;
        }
      }

      const crdtUpdate = this.ydocManager.getUpdate(noteId, null);
      const clientStateVector = this.ydocManager.getStateVector(noteId);
      try {
        const response = await this.handleAuthenticatedCall(() =>
          this.backendClient.syncDocument({
            clientId,
            workspaceId,
            documentId: noteId,
            crdtUpdate,
            clientStateVector,
            title: row.title,
            path: row.relative_path,
          }),
        );
        if (!response) continue;

        if (response.crdtUpdate?.length > 0) {
          this.ydocManager.applyUpdate(noteId, response.crdtUpdate);
          this.sendRemoteCrdtUpdate?.(noteId, response.crdtUpdate);
          const markdown = await this.ydocManager.materializeMarkdown(noteId);
          const noteRow = this.metadataStore.getNoteById(noteId);
          if (noteRow) {
            await this.workspaceService.writeMarkdownFile(noteRow.relative_path, markdown);
          }
        }
        this.metadataStore.updateNoteRevision(noteId, response.serverVersion);
      } catch (err) {
        console.error(`Full sync push failed for ${noteId}:`, err?.message ?? err);
      }
    }

    // 2. Pull ALL server documents (from revision 0) to get anything missing locally
    const pullResponse = await this.handleAuthenticatedCall(() =>
      this.backendClient.pullChanges({ clientId, workspaceId, lastSeenRevision: 0 }),
    );
    if (pullResponse) {
      const localIds = new Set(allRows.map((r) => r.id));
      for (const document of pullResponse.documents ?? []) {
        if (localIds.has(document.id)) {
          // Already synced in the push phase above
          continue;
        }

        // Skip notes deleted on server or locally
        const existingRow = this.metadataStore.getNoteById(document.id);
        if (existingRow?.deleted || document.deleted) continue;

        // New document from server — create locally
        if (document.crdtState?.length > 0) {
          this.ydocManager.applyUpdate(document.id, document.crdtState);
          this.ydocManager.persist(document.id);
          const markdown = await this.ydocManager.materializeMarkdown(document.id);
          await this.workspaceService.writeRemoteNote({
            id: document.id,
            title: document.title,
            path: document.path,
            markdown,
            acceptedRevision: Number(document.acceptedRevision),
          });
        } else {
          await this.workspaceService.writeRemoteNote({
            ...document,
            acceptedRevision: Number(document.acceptedRevision),
          });
        }
        this.sendRemoteCrdtUpdate?.(document.id, this.ydocManager.getFullState(document.id));
      }
      this.metadataStore.setSetting("lastSeenRevision", Number(pullResponse.latestRevision ?? 0));
    }

    // 3. Sync pending attachments
    await this.syncPendingAttachments();
    const dirtyAfterAttachments = this.metadataStore.listDirtyNotes();
    if (dirtyAfterAttachments.length > 0) {
      await this.syncCrdtNotes(clientId, workspaceId);
    }

    return this.getSnapshot();
  }

  async syncDeletedNotes(clientId, workspaceId) {
    const deletedRows = this.metadataStore.listDeletedDirtyNotes();
    for (const row of deletedRows) {
      try {
        const response = await this.handleAuthenticatedCall(() =>
          this.backendClient.deleteDocument({
            clientId,
            workspaceId,
            documentId: row.id,
            knownServerRevision: row.accepted_revision ?? 0,
          }),
        );
        if (response) {
          this.metadataStore.updateNoteRevision(row.id, response.acceptedRevision ?? row.accepted_revision);
        }
      } catch (err) {
        console.error(`Delete sync failed for ${row.id}:`, err?.message ?? err);
      }
    }
  }

  async syncCrdtNotes(clientId, workspaceId) {
    const dirtyRows = this.metadataStore.listDirtyNotes();
    for (const row of dirtyRows) {
      const noteId = row.id;
      const crdtUpdate = this.ydocManager.getUpdate(noteId, null); // full state as update
      const clientStateVector = this.ydocManager.getStateVector(noteId);
      try {
        const response = await this.handleAuthenticatedCall(() =>
          this.backendClient.syncDocument({
            clientId,
            workspaceId,
            documentId: noteId,
            crdtUpdate,
            clientStateVector,
            title: row.title,
            path: row.relative_path,
          }),
        );
        if (!response) continue;

        // Apply delta from server
        if (response.crdtUpdate?.length > 0) {
          this.ydocManager.applyUpdate(noteId, response.crdtUpdate);
          this.sendRemoteCrdtUpdate?.(noteId, response.crdtUpdate);
          const markdown = await this.ydocManager.materializeMarkdown(noteId);
          const noteRow = this.metadataStore.getNoteById(noteId);
          if (noteRow) {
            await this.workspaceService.writeMarkdownFile(noteRow.relative_path, markdown);
          }
        }
        this.metadataStore.updateNoteRevision(noteId, response.serverVersion);
      } catch (err) {
        console.error(`CRDT sync failed for ${noteId}:`, err?.message ?? err);
      }
    }
  }

  async pullCrdtChanges(clientId, workspaceId) {
    const lastSeenRevision = this.metadataStore.getSetting("lastSeenRevision", 0);
    const pullResponse = await this.handleAuthenticatedCall(() =>
      this.backendClient.pullChanges({ clientId, workspaceId, lastSeenRevision }),
    );
    if (!pullResponse) return;

    for (const document of pullResponse.documents ?? []) {
      // Skip notes deleted on server or locally
      const existingRow = this.metadataStore.getNoteById(document.id);
      if (existingRow?.deleted || document.deleted) continue;

      if (document.crdtState?.length > 0) {
        this.ydocManager.applyUpdate(document.id, document.crdtState);
        this.ydocManager.persist(document.id);
        const markdown = await this.ydocManager.materializeMarkdown(document.id);
        if (existingRow) {
          await this.workspaceService.writeMarkdownFile(existingRow.relative_path, markdown);
        }
        this.metadataStore.updateNoteRevision(document.id, Number(document.acceptedRevision));
        this.sendRemoteCrdtUpdate?.(document.id, this.ydocManager.getFullState(document.id));
      } else {
        // Legacy fallback for docs without CRDT state
        await this.workspaceService.writeRemoteNote({
          ...document,
          acceptedRevision: Number(document.acceptedRevision),
        });
      }
    }
    this.metadataStore.setSetting("lastSeenRevision", Number(pullResponse.latestRevision ?? lastSeenRevision));
  }

  async syncNow() {
    if (!this.syncEnabled()) {
      await this.refreshBackendStatus();
      if (!this.syncEnabled()) return this.getSnapshot();
    }

    this.sendSyncStatus?.("syncing");

    const clientId = this.metadataStore.getSetting("clientId");
    const workspaceId = this.metadataStore.getSetting("authenticatedWorkspaceId");
    const ownerUserId = this.metadataStore.getSetting("authenticatedUserId");
    if (!workspaceId || !ownerUserId) {
      this.markSignedOut();
      return this.getSnapshot();
    }

    // Push deletions to backend
    await this.syncDeletedNotes(clientId, workspaceId);
    // Push dirty notes via CRDT delta
    await this.syncCrdtNotes(clientId, workspaceId);
    // Pull remote changes
    await this.pullCrdtChanges(clientId, workspaceId);
    // Sync pending attachments (URL rewriting happens as Y.Doc operations)
    await this.syncPendingAttachments();
    // If attachments were synced, push the URL-rewritten CRDT updates
    const dirtyAfterAttachments = this.metadataStore.listDirtyNotes();
    if (dirtyAfterAttachments.length > 0) {
      await this.syncCrdtNotes(clientId, workspaceId);
    }

    this.sendSyncStatus?.("synced");
    return this.getSnapshot();
  }

  async searchNotes(query) {
    const localNotes = await this.workspaceService.searchNotes(query);
    if (!this.syncEnabled()) {
      return localNotes;
    }

    const workspaceId = this.metadataStore.getSetting("authenticatedWorkspaceId");
    const remoteResults = await this.handleAuthenticatedCall(() =>
      this.backendClient.searchDocuments({
        workspaceId,
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
}
