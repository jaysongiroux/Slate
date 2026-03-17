import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { JobsModule } from "../jobs/jobs.module";
import { StorageModule } from "../storage/storage.module";
import { AttachmentsController } from "./attachments.controller";
import { AttachmentsGuard } from "./attachments.guard";
import { AttachmentsService } from "./attachments.service";
import { ImageProcessorService } from "./image-processor.service";

@Module({
  imports: [StorageModule, AuthModule, forwardRef(() => JobsModule)],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, AttachmentsGuard, ImageProcessorService],
  exports: [AttachmentsService, ImageProcessorService],
})
export class AttachmentsModule {}
