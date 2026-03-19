import { Injectable, OnModuleInit } from "@nestjs/common";
import { AppConfigName } from "@slate/server-db";
import { join } from "node:path";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) { }

  async onModuleInit() {
    await this.ensureSetting(AppConfigName.ACCOUNT_CREATION_ENABLED, "true");
    await this.ensureSetting(AppConfigName.PASSWORD_AUTH_ENABLED, "true");
    await this.ensureSetting(AppConfigName.STORAGE_BACKEND, "filesystem");
    await this.ensureSetting(AppConfigName.STORAGE_FILESYSTEM_ROOT, join(process.cwd(), "data", "attachments"));
    await this.ensureSetting(AppConfigName.STORAGE_S3_ENDPOINT, "");
    await this.ensureSetting(AppConfigName.STORAGE_S3_BUCKET, "");
    await this.ensureSetting(AppConfigName.STORAGE_S3_ACCESS_KEY_ID, "");
    await this.ensureSetting(AppConfigName.STORAGE_S3_SECRET_ACCESS_KEY, "");
  }

  async ensureSetting(name: AppConfigName, defaultValue: string) {
    return this.prisma.appConfig.upsert({
      where: { name },
      update: {},
      create: {
        name,
        value: defaultValue,
      },
    });
  }

  async getSettingValue(name: AppConfigName, defaultValue: string) {
    const setting = await this.ensureSetting(name, defaultValue);
    return setting.value;
  }

  async setSettingValue(name: AppConfigName, value: string) {
    return this.prisma.appConfig.upsert({
      where: { name },
      update: { value },
      create: { name, value },
    });
  }

  parseBoolean(value: string, fallback: boolean) {
    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }

    return fallback;
  }

  async accountCreationEnabled() {
    const value = await this.getSettingValue(AppConfigName.ACCOUNT_CREATION_ENABLED, "true");
    return this.parseBoolean(value, true);
  }

  async passwordAuthEnabled() {
    const value = await this.getSettingValue(AppConfigName.PASSWORD_AUTH_ENABLED, "true");
    return this.parseBoolean(value, true);
  }

  async updateAccountCreationEnabled(enabled: boolean) {
    return this.setSettingValue(AppConfigName.ACCOUNT_CREATION_ENABLED, enabled ? "true" : "false");
  }

  async updatePasswordAuthEnabled(enabled: boolean) {
    return this.setSettingValue(AppConfigName.PASSWORD_AUTH_ENABLED, enabled ? "true" : "false");
  }

  async getStorageBackend(): Promise<string> {
    return this.getSettingValue(AppConfigName.STORAGE_BACKEND, "filesystem");
  }

  async getStorageFilesystemRoot(): Promise<string> {
    return this.getSettingValue(AppConfigName.STORAGE_FILESYSTEM_ROOT, join(process.cwd(), "data", "attachments"));
  }

  async getStorageS3Endpoint(): Promise<string> {
    return this.getSettingValue(AppConfigName.STORAGE_S3_ENDPOINT, "");
  }

  async getStorageS3Bucket(): Promise<string> {
    return this.getSettingValue(AppConfigName.STORAGE_S3_BUCKET, "");
  }

  async getStorageS3AccessKeyId(): Promise<string> {
    return this.getSettingValue(AppConfigName.STORAGE_S3_ACCESS_KEY_ID, "");
  }

  async getStorageS3SecretAccessKey(): Promise<string> {
    return this.getSettingValue(AppConfigName.STORAGE_S3_SECRET_ACCESS_KEY, "");
  }

  async listSettings() {
    await this.ensureSetting(AppConfigName.ACCOUNT_CREATION_ENABLED, "true");
    await this.ensureSetting(AppConfigName.PASSWORD_AUTH_ENABLED, "true");
    await this.ensureSetting(AppConfigName.STORAGE_BACKEND, "filesystem");
    await this.ensureSetting(AppConfigName.STORAGE_FILESYSTEM_ROOT, join(process.cwd(), "data", "attachments"));
    await this.ensureSetting(AppConfigName.STORAGE_S3_ENDPOINT, "");
    await this.ensureSetting(AppConfigName.STORAGE_S3_BUCKET, "");
    await this.ensureSetting(AppConfigName.STORAGE_S3_ACCESS_KEY_ID, "");
    await this.ensureSetting(AppConfigName.STORAGE_S3_SECRET_ACCESS_KEY, "");

    const settings = await this.prisma.appConfig.findMany({
      orderBy: { name: "asc" },
    });

    return settings.map((setting) => ({
      name: setting.name,
      value: setting.value,
      createdAt: setting.createdAt,
      updatedAt: setting.updatedAt,
    }));
  }
}
