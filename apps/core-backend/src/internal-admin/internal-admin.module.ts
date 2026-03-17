import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { InternalAdminController } from "./internal-admin.controller";
import { InternalAdminGuard } from "./internal-admin.guard";

@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [InternalAdminController],
  providers: [InternalAdminGuard],
})
export class InternalAdminModule {}
