import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { DocumentsService } from "./documents.service";

@Controller()
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @GrpcMethod("DocumentService", "UpsertDocument")
  upsertDocument(payload: {
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
  }) {
    return this.documentsService.upsert(payload);
  }

  @GrpcMethod("DocumentService", "DeleteDocument")
  deleteDocument(payload: { clientId: string; workspaceId: string; documentId: string; knownServerRevision: string | number }) {
    return this.documentsService.remove(payload);
  }

  @GrpcMethod("DocumentService", "PullChanges")
  pullChanges(payload: { clientId: string; workspaceId: string; lastSeenRevision: string | number }) {
    return this.documentsService.pull(payload);
  }
}

