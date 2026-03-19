import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

export class BackendClient {
  constructor({ protoPath, metadataStore }) {
    this.metadataStore = metadataStore;
    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });
    this.proto = grpc.loadPackageDefinition(packageDefinition).slate.v1;
  }

  endpoint() {
    return this.metadataStore.getSetting("backendEndpoint", "localhost:50051");
  }

  workspaceClient(endpoint = this.endpoint()) {
    return new this.proto.WorkspaceService(endpoint, grpc.credentials.createInsecure());
  }

  authClient(endpoint = this.endpoint()) {
    return new this.proto.AuthService(endpoint, grpc.credentials.createInsecure());
  }

  documentClient(endpoint = this.endpoint()) {
    return new this.proto.DocumentService(endpoint, grpc.credentials.createInsecure());
  }

  searchClient(endpoint = this.endpoint()) {
    return new this.proto.SearchService(endpoint, grpc.credentials.createInsecure());
  }

  async checkConnection(endpoint) {
    const client = new this.proto.WorkspaceService(
      endpoint,
      grpc.credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + 5000);
    return new Promise((resolve, reject) => {
      client.waitForReady(deadline, (error) => {
        client.close();
        if (error) {
          reject(new Error("Could not reach server"));
        } else {
          resolve(true);
        }
      });
    });
  }

  async resolveDevSession(clientId, deviceName) {
    return this.resolveDevSessionAt(this.endpoint(), clientId, deviceName);
  }

  async resolveDevSessionAt(endpoint, clientId, deviceName) {
    return this.unary(this.workspaceClient(endpoint), "ResolveDevSession", {
      clientId,
      deviceName
    });
  }

  async listAuthProviders(endpoint = this.endpoint()) {
    return this.unary(this.authClient(endpoint), "ListAuthProviders", {});
  }

  async loginWithPasswordAt(endpoint, payload) {
    return this.unary(this.authClient(endpoint), "LoginWithPassword", payload);
  }

  async getCurrentSessionAt(endpoint, accessToken) {
    return this.unary(this.authClient(endpoint), "GetCurrentSession", {}, this.authMetadata(accessToken));
  }

  async startOidcAt(endpoint, payload) {
    return this.unary(this.authClient(endpoint), "StartOidc", payload);
  }

  async completeOidcAt(endpoint, payload) {
    return this.unary(this.authClient(endpoint), "CompleteOidc", payload);
  }

  async upsertDocument(payload) {
    return this.unary(this.documentClient(), "UpsertDocument", payload, this.currentAuthMetadata());
  }

  async pullChanges(payload) {
    return this.unary(this.documentClient(), "PullChanges", payload, this.currentAuthMetadata());
  }

  async syncDocument(payload) {
    return this.unary(this.documentClient(), "SyncDocument", payload, this.currentAuthMetadata());
  }

  async bootstrapDocument(payload) {
    return this.unary(this.documentClient(), "BootstrapDocument", payload, this.currentAuthMetadata());
  }

  async searchDocuments(payload) {
    return this.unary(this.searchClient(), "SearchDocuments", payload, this.currentAuthMetadata());
  }

  authMetadata(accessToken) {
    const metadata = new grpc.Metadata();
    if (accessToken) {
      metadata.set("authorization", `Bearer ${accessToken}`);
    }
    return metadata;
  }

  currentAuthMetadata() {
    return this.authMetadata(this.metadataStore.getSetting("accessToken", ""));
  }

  isUnauthenticatedError(error) {
    return error?.code === grpc.status.UNAUTHENTICATED || error?.code === grpc.status.PERMISSION_DENIED;
  }

  httpBaseUrl(endpoint = this.endpoint()) {
    const host = endpoint.replace(/:50051$/, "");
    return `http://${host}:4000`;
  }

  async uploadAttachment(endpoint, accessToken, { buffer, fileName, mimeType, workspaceId, documentId }) {
    const baseUrl = this.httpBaseUrl(endpoint);
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType }), fileName);
    form.append("workspaceId", workspaceId);
    form.append("documentId", documentId);

    const response = await fetch(`${baseUrl}/api/attachments/upload`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      body: form,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Upload failed (${response.status}): ${text}`);
    }

    return response.json();
  }

  resolveAttachmentUrl(endpoint, accessToken, contentUrl) {
    const baseUrl = this.httpBaseUrl(endpoint);
    return `${baseUrl}${contentUrl}?token=${encodeURIComponent(accessToken)}`;
  }

  unary(client, method, payload, metadata) {
    return new Promise((resolve, reject) => {
      const callback = (error, response) => {
        client.close?.();
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
      };

      if (metadata) {
        client[method](payload, metadata, callback);
      } else {
        client[method](payload, callback);
      }
    });
  }
}
