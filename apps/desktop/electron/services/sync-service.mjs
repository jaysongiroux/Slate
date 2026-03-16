import crypto from "node:crypto";

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
    if (!this.metadataStore.getSetting("backendEndpoint")) {
      this.metadataStore.setSetting("backendEndpoint", "localhost:50051");
    }
    this.workspaceService.onWorkspaceDirty(() => {
      if (this.metadataStore.getSetting("connected", false)) {
        this.scheduleSync();
      }
    });
  }

  scheduleSync() {
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }
    this.syncTimeout = setTimeout(() => {
      void this.syncNow();
    }, 1200);
  }

  async connectBackend() {
    const clientId = this.metadataStore.getSetting("clientId");
    const deviceName = this.workspaceService.getWorkspaceProfile().name;
    const session = await this.backendClient.resolveDevSession(clientId, deviceName);
    this.metadataStore.setSetting("connected", true);
    this.metadataStore.setSetting("linkedUserId", session.userId);
    this.metadataStore.setSetting("linkedWorkspaceId", session.workspaceId);
    this.metadataStore.setSetting("workspaceName", session.workspaceName);
    return {
      endpoint: this.metadataStore.getSetting("backendEndpoint"),
      clientId,
      connected: true,
      linkedUserId: session.userId,
      linkedWorkspaceId: session.workspaceId
    };
  }

  async syncNow() {
    if (!this.metadataStore.getSetting("connected", false)) {
      await this.connectBackend();
    }

    const clientId = this.metadataStore.getSetting("clientId");
    const workspaceId = this.metadataStore.getSetting("linkedWorkspaceId");
    const ownerUserId = this.metadataStore.getSetting("linkedUserId");
    const dirtyRows = this.metadataStore.listDirtyNotes();
    const dirtyNotes = await Promise.all(dirtyRows.map((row) => this.workspaceService.materializeRow(row)));

    for (const note of dirtyNotes) {
      const response = await this.backendClient.upsertDocument({
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
          deleted: false
        }
      });

      if (response.conflict?.serverDocument) {
        await this.workspaceService.writeRemoteNote({
          ...response.conflict.serverDocument,
          acceptedRevision: Number(response.conflict.serverDocument.acceptedRevision)
        });
      } else if (response.document) {
        await this.workspaceService.writeRemoteNote({
          ...response.document,
          acceptedRevision: Number(response.document.acceptedRevision)
        });
      }
    }

    const lastSeenRevision = this.metadataStore.getSetting("lastSeenRevision", 0);
    const pullResponse = await this.backendClient.pullChanges({
      clientId,
      workspaceId,
      lastSeenRevision
    });

    for (const document of pullResponse.documents ?? []) {
      await this.workspaceService.writeRemoteNote({
        ...document,
        acceptedRevision: Number(document.acceptedRevision)
      });
    }

    this.metadataStore.setSetting("lastSeenRevision", Number(pullResponse.latestRevision ?? lastSeenRevision));

    return this.getSnapshot();
  }

  async searchNotes(query) {
    const localNotes = await this.workspaceService.searchNotes(query);
    if (!this.metadataStore.getSetting("connected", false)) {
      return localNotes;
    }

    const workspaceId = this.metadataStore.getSetting("linkedWorkspaceId");
    const remoteResults = await this.backendClient.searchDocuments({
      workspaceId,
      query,
      limit: 20
    });

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
          syncState: "idle"
        });
      }
    }

    return Array.from(localById.values());
  }

  async getSnapshot() {
    const workspace = this.workspaceService.getWorkspaceProfile();
    const notes = await this.workspaceService.listNotes();
    return {
      workspace,
      backend: {
        endpoint: this.metadataStore.getSetting("backendEndpoint", "localhost:50051"),
        clientId: this.metadataStore.getSetting("clientId", "desktop-client"),
        connected: this.metadataStore.getSetting("connected", false),
        linkedUserId: this.metadataStore.getSetting("linkedUserId", undefined),
        linkedWorkspaceId: this.metadataStore.getSetting("linkedWorkspaceId", undefined)
      },
      notes
    };
  }
}
