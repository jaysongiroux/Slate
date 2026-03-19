import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { StorageService } from "./storage.service";

@Module({
  imports: [SettingsModule],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
