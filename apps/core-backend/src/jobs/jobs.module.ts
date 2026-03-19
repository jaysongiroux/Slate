import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { JobHandlersService } from "./job-handlers.service";
import { JobsService } from "./jobs.service";

@Module({
  imports: [StorageModule],
  providers: [JobsService, JobHandlersService],
  exports: [JobsService, JobHandlersService],
})
export class JobsModule {}
