import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { JobsModule } from "../jobs/jobs.module";
import { SettingsModule } from "../settings/settings.module";
import { StorageModule } from "../storage/storage.module";
import { InternalAdminController } from "./internal-admin.controller";
import { InternalAdminGuard } from "./internal-admin.guard";

@Module({
  imports: [AuthModule, SettingsModule, StorageModule, JobsModule],
  controllers: [InternalAdminController],
  providers: [InternalAdminGuard],
})
export class InternalAdminModule {}
