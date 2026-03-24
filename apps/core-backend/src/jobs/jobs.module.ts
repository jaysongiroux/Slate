import { Module, forwardRef } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { AiModule } from "../ai/ai.module";
import { JobHandlersService } from "./job-handlers.service";
import { JobsService } from "./jobs.service";

@Module({
  imports: [StorageModule, forwardRef(() => AiModule)],
  providers: [JobsService, JobHandlersService],
  exports: [JobsService, JobHandlersService],
})
export class JobsModule {}
