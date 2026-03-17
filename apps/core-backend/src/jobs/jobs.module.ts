import { Module, forwardRef } from "@nestjs/common";
import { AttachmentsModule } from "../attachments/attachments.module";
import { StorageModule } from "../storage/storage.module";
import { JobHandlersService } from "./job-handlers.service";
import { JobsService } from "./jobs.service";

@Module({
  imports: [StorageModule, forwardRef(() => AttachmentsModule)],
  providers: [JobsService, JobHandlersService],
  exports: [JobsService],
})
export class JobsModule {}
