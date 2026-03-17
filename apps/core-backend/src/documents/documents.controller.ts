import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { Metadata } from "@grpc/grpc-js";
import { AuthSessionService } from "../auth/auth-session.service";
import { DocumentsService } from "./documents.service";

@Controller()
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly authSessionService: AuthSessionService
  ) {}

  @GrpcMethod("DocumentService", "UpsertDocument")
  async upsertDocument(payload: {
    clientId: string;
    workspaceId: string;
    knownServerRevision: string | number;
    document: {
      id: string;
      ownerUserId: string;
      title: string;
      path: string;
      markdown: string;
      plainText: string;
      deleted?: boolean;
    };
  }, metadata: Metadata) {
    const principal = await this.authSessionService.requireSession(metadata);
    return this.documentsService.upsert(payload, principal);
  }

  @GrpcMethod("DocumentService", "DeleteDocument")
  async deleteDocument(payload: { clientId: string; workspaceId: string; documentId: string; knownServerRevision: string | number }, metadata: Metadata) {
    const principal = await this.authSessionService.requireSession(metadata);
    return this.documentsService.remove(payload, principal);
  }

  @GrpcMethod("DocumentService", "PullChanges")
  async pullChanges(payload: { clientId: string; workspaceId: string; lastSeenRevision: string | number }, metadata: Metadata) {
    const principal = await this.authSessionService.requireSession(metadata);
    return this.documentsService.pull(payload, principal);
  }
}
