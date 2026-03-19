import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { StorageModule } from "../storage/storage.module";
import { AttachmentsController } from "./attachments.controller";
import { AttachmentsGuard } from "./attachments.guard";
import { AttachmentsService } from "./attachments.service";

@Module({
  imports: [StorageModule, AuthModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, AttachmentsGuard],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
