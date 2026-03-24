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
    const client = new this.proto.AuthService(
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

  async listAuthProviders(endpoint = this.endpoint()) {
    return this.unary(this.authClient(endpoint), "ListAuthProviders", {});
  }

  async loginWithPasswordAt(endpoint, payload) {
    return this.unary(this.authClient(endpoint), "LoginWithPassword", payload);
  }

  async getCurrentSessionAt(endpoint, accessToken) {
    return this.unary(this.authClient(endpoint), "GetCurrentSession", {}, this.authMetadata(accessToken));
  }

  async refreshTokensAt(endpoint, refreshToken) {
    return this.unary(this.authClient(endpoint), "RefreshTokens", { refreshToken });
  }

  async startOidcAt(endpoint, payload) {
    return this.unary(this.authClient(endpoint), "StartOidc", payload);
  }

  async completeOidcAt(endpoint, payload) {
    return this.unary(this.authClient(endpoint), "CompleteOidc", payload);
  }

  async searchDocuments(payload) {
    return this.unary(this.searchClient(), "SearchDocuments", payload, this.currentAuthMetadata());
  }

  async pushDocumentUpdate(payload) {
    return this.unary(this.documentClient(), "PushDocumentUpdate", payload, this.currentAuthMetadata());
  }

  async pullDocumentEvents(payload) {
    return this.unary(this.documentClient(), "PullDocumentEvents", payload, this.currentAuthMetadata());
  }

  async getDocumentSnapshot(payload) {
    return this.unary(this.documentClient(), "GetDocumentSnapshot", payload, this.currentAuthMetadata());
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

  async uploadAttachment(endpoint, accessToken, { buffer, fileName, mimeType, documentId }) {
    const baseUrl = this.httpBaseUrl(endpoint);
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType }), fileName);
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

  aiClient(endpoint = this.endpoint()) {
    return new this.proto.AiService(endpoint, grpc.credentials.createInsecure());
  }

  async getAiConfig() {
    return this.unary(this.aiClient(), "GetAiConfig", {}, this.currentAuthMetadata());
  }

  async updateAiConfig(payload) {
    return this.unary(this.aiClient(), "UpdateAiConfig", payload, this.currentAuthMetadata());
  }

  async createConversation() {
    return this.unary(this.aiClient(), "CreateConversation", {}, this.currentAuthMetadata());
  }

  async listConversations() {
    return this.unary(this.aiClient(), "ListConversations", {}, this.currentAuthMetadata());
  }

  async deleteConversation(payload) {
    return this.unary(this.aiClient(), "DeleteConversation", payload, this.currentAuthMetadata());
  }

  async getConversationMessages(payload) {
    return this.unary(this.aiClient(), "GetConversationMessages", payload, this.currentAuthMetadata());
  }

  async triggerEmbedding() {
    return this.unary(this.aiClient(), "TriggerEmbedding", {}, this.currentAuthMetadata());
  }

  streamSendMessage(payload, onEvent) {
    const client = this.aiClient();
    const metadata = this.currentAuthMetadata();
    const stream = client.SendMessage(payload, metadata);

    stream.on("data", (response) => {
      onEvent(response);
    });

    stream.on("error", (error) => {
      if (error.code !== grpc.status.CANCELLED) {
        const raw = typeof error.details === "string" && error.details.trim()
          ? error.details.trim()
          : error.message || "Request failed";
        const content = raw.replace(/^\d+\s+\w+:\s*/i, "").trim() || raw;
        onEvent({ type: "error", content });
      }
    });

    stream.on("end", () => {
      client.close?.();
    });

    return stream;
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
