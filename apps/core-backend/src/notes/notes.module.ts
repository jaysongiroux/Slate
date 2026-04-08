import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DocumentsModule } from "../documents/documents.module";
import { NotesController } from "./notes.controller";

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [NotesController],
})
export class NotesModule {}
