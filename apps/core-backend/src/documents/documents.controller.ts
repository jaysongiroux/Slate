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

  @GrpcMethod("DocumentService", "PushDocumentUpdate")
  async pushDocumentUpdate(payload: {
    clientId: string;
    documentId: string;
    path: string;
    deleted: boolean;
    crdtUpdate: Buffer | Uint8Array;
    clientStateVector?: Buffer | Uint8Array;
  }, metadata: Metadata) {
    const principal = await this.authSessionService.requireSession(metadata);
    return this.documentsService.pushDocumentUpdate(payload, principal);
  }

  @GrpcMethod("DocumentService", "PullDocumentEvents")
  async pullDocumentEvents(payload: { clientId: string; sinceServerSeq: string | number }, metadata: Metadata) {
    const principal = await this.authSessionService.requireSession(metadata);
    return this.documentsService.pullDocumentEvents(payload, principal);
  }

  @GrpcMethod("DocumentService", "GetDocumentSnapshot")
  async getDocumentSnapshot(payload: { documentId: string }, metadata: Metadata) {
    const principal = await this.authSessionService.requireSession(metadata);
    return this.documentsService.getDocumentSnapshot(payload, principal);
  }
}
