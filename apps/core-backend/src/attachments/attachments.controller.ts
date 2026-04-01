import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { GrpcMethod } from "@nestjs/microservices";
import type { Response } from "express";
import { AttachmentsGuard, type AttachmentRequest } from "./attachments.guard";
import { AttachmentsService } from "./attachments.service";

@Controller()
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @GrpcMethod("AttachmentService", "RegisterAttachment")
  registerAttachment(payload: {
    documentId: string;
    originalName: string;
    mimeType: string;
    sizeBytes: string | number;
  }) {
    return this.attachmentsService.register(payload);
  }

  @Post("api/attachments/upload")
  @UseGuards(AttachmentsGuard)
  @UseInterceptors(FileInterceptor("file"))
  async upload(@UploadedFile() file: Express.Multer.File, @Req() request: AttachmentRequest) {
    const userId = request.userSession!.userId;
    const documentId = request.body?.documentId as string;

    const attachment = await this.attachmentsService.registerAndStore({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      userId,
      documentId,
    });

    return {
      id: attachment.id,
      contentUrl: `/api/attachments/${attachment.id}/content`,
    };
  }

  @Get("api/attachments/:id/content")
  @UseGuards(AttachmentsGuard)
  async content(
    @Param("id") id: string,
    @Req() request: AttachmentRequest,
    @Res() response: Response,
  ) {
    const result = await this.attachmentsService.getContentStream(id, request.userSession!.userId);

    response.set({
      "Content-Type": result.mimeType,
      "Cache-Control": "private, max-age=31536000, immutable",
    });

    result.stream.pipe(response);
  }
}
