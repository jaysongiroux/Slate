import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { AttachmentsService } from "./attachments.service";

@Controller()
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @GrpcMethod("AttachmentService", "RegisterAttachment")
  registerAttachment(payload: {
    workspaceId: string;
    documentId: string;
    originalName: string;
    mimeType: string;
    sizeBytes: string | number;
  }) {
    return this.attachmentsService.register(payload);
  }
}

