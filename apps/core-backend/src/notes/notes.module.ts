import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotesController } from "./notes.controller";

@Module({
  imports: [AuthModule],
  controllers: [NotesController],
})
export class NotesModule {}
