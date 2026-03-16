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

  workspaceClient() {
    return new this.proto.WorkspaceService(this.endpoint(), grpc.credentials.createInsecure());
  }

  documentClient() {
    return new this.proto.DocumentService(this.endpoint(), grpc.credentials.createInsecure());
  }

  searchClient() {
    return new this.proto.SearchService(this.endpoint(), grpc.credentials.createInsecure());
  }

  async resolveDevSession(clientId, deviceName) {
    return this.unary(this.workspaceClient(), "ResolveDevSession", {
      clientId,
      deviceName
    });
  }

  async upsertDocument(payload) {
    return this.unary(this.documentClient(), "UpsertDocument", payload);
  }

  async pullChanges(payload) {
    return this.unary(this.documentClient(), "PullChanges", payload);
  }

  async searchDocuments(payload) {
    return this.unary(this.searchClient(), "SearchDocuments", payload);
  }

  unary(client, method, payload) {
    return new Promise((resolve, reject) => {
      client[method](payload, (error, response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
      });
    });
  }
}
