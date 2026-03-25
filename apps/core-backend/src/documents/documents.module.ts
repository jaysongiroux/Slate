import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { JobsModule } from "../jobs/jobs.module";
import { CrdtService } from "./crdt.service";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";

@Module({
  imports: [AuthModule, JobsModule],
  controllers: [DocumentsController],
  providers: [CrdtService, DocumentsService],
  exports: [DocumentsService, CrdtService]
})
export class DocumentsModule {}
