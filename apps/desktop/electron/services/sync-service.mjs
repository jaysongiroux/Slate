import crypto from "node:crypto";

const DEFAULT_ENDPOINT = "localhost:50051";

export class SyncService {
  constructor({ metadataStore, workspaceService, backendClient }) {
    this.metadataStore = metadataStore;
    this.workspaceService = workspaceService;
    this.backendClient = backendClient;
    this.syncTimeout = null;
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
    return this.metadataStore.getSetting("backendReachable", false) && this.metadataStore.getSetting("authStatus", "signed_out") === "authenticated";
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
    this.metadataStore.setSetting("workspaceName", session.workspaceName ?? this.workspaceService.getWorkspaceProfile().name);
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
      const session = await this.backendClient.getCurrentSessionAt(endpoint, this.metadataStore.getSetting("accessToken", ""));
      const merged = {
        ...session,
        tokens: {
          accessToken: this.metadataStore.getSetting("accessToken", ""),
          refreshToken: this.metadataStore.getSetting("refreshToken", ""),
          expiresAtUnix: this.metadataStore.getSetting("tokenExpiresAtUnix", 0),
        },
      };
      const backend = this.storeAuthenticatedSession(merged, endpoint);
      this.scheduleSync();
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
    await this.syncNow();
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
    await this.syncNow();
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

  async syncNow() {
    if (!this.syncEnabled()) {
      await this.refreshBackendStatus();
      if (!this.syncEnabled()) {
        return this.getSnapshot();
      }
    }

    const clientId = this.metadataStore.getSetting("clientId");
    const workspaceId = this.metadataStore.getSetting("authenticatedWorkspaceId");
    const ownerUserId = this.metadataStore.getSetting("authenticatedUserId");
    if (!workspaceId || !ownerUserId) {
      this.markSignedOut();
      return this.getSnapshot();
    }

    const dirtyRows = this.metadataStore.listDirtyNotes();
    const dirtyNotes = await Promise.all(dirtyRows.map((row) => this.workspaceService.materializeRow(row)));

    for (const note of dirtyNotes) {
      const response = await this.handleAuthenticatedCall(() =>
        this.backendClient.upsertDocument({
          clientId,
          workspaceId,
          knownServerRevision: note.acceptedRevision,
          document: {
            id: note.id,
            workspaceId,
            ownerUserId,
            title: note.title,
            path: note.path,
            markdown: note.markdown,
            plainText: note.plainText,
            deleted: false,
          },
        })
      );

      if (!response) {
        return this.getSnapshot();
      }

      if (response.conflict?.serverDocument) {
        await this.workspaceService.writeRemoteNote({
          ...response.conflict.serverDocument,
          acceptedRevision: Number(response.conflict.serverDocument.acceptedRevision),
        });
      } else if (response.document) {
        await this.workspaceService.writeRemoteNote({
          ...response.document,
          acceptedRevision: Number(response.document.acceptedRevision),
        });
      }
    }

    const lastSeenRevision = this.metadataStore.getSetting("lastSeenRevision", 0);
    const pullResponse = await this.handleAuthenticatedCall(() =>
      this.backendClient.pullChanges({
        clientId,
        workspaceId,
        lastSeenRevision,
      })
    );

    if (!pullResponse) {
      return this.getSnapshot();
    }

    for (const document of pullResponse.documents ?? []) {
      await this.workspaceService.writeRemoteNote({
        ...document,
        acceptedRevision: Number(document.acceptedRevision),
      });
    }

    this.metadataStore.setSetting("lastSeenRevision", Number(pullResponse.latestRevision ?? lastSeenRevision));
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
      })
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
