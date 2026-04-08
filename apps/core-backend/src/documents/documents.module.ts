import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { JobsModule } from "../jobs/jobs.module";
import { CrdtService } from "./crdt.service";
import { DocumentsService } from "./documents.service";

@Module({
  imports: [AuthModule, JobsModule],
  providers: [CrdtService, DocumentsService],
  exports: [DocumentsService, CrdtService],
})
export class DocumentsModule {}
