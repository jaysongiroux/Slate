import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppConfigName } from "@slate/server-db";
import { join } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { encryptSecret, decryptSecret } from "../ai/encryption.util";

type AppSettingRecord = {
  name: AppConfigName;
  value: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get encryptionKey(): string {
    return this.config.get<string>("CALENDAR_ENCRYPTION_KEY", "local-dev-calendar-secret");
  }

  async onModuleInit() {
    await this.ensureSetting(AppConfigName.ACCOUNT_CREATION_ENABLED, "true");
    await this.ensureSetting(AppConfigName.PASSWORD_AUTH_ENABLED, "true");
    await this.ensureSetting(AppConfigName.STORAGE_BACKEND, "filesystem");
    await this.ensureSetting(
      AppConfigName.STORAGE_FILESYSTEM_ROOT,
      join(process.cwd(), "data", "attachments"),
    );
    await this.ensureSetting(AppConfigName.STORAGE_S3_ENDPOINT, "");
    await this.ensureSetting(AppConfigName.STORAGE_S3_BUCKET, "");
    await this.ensureSetting(AppConfigName.STORAGE_S3_ACCESS_KEY_ID, "");
    await this.ensureSetting(AppConfigName.STORAGE_S3_SECRET_ACCESS_KEY, "");
    // Seed from env vars on first run, then DB takes over
    await this.seedCalendarConfig();
  }

  private async seedCalendarConfig() {
    const existingId = await this.prisma.appConfig.findUnique({
      where: { name: AppConfigName.GOOGLE_CALENDAR_CLIENT_ID },
    });
    if (!existingId) {
      const envId = this.config.get<string>("GOOGLE_CALENDAR_CLIENT_ID", "");
      if (envId) this.logger.log("Seeding Google Calendar client ID from env");
      await this.ensureSetting(AppConfigName.GOOGLE_CALENDAR_CLIENT_ID, envId);
    }
    const existingSecret = await this.prisma.appConfig.findUnique({
      where: { name: AppConfigName.GOOGLE_CALENDAR_CLIENT_SECRET },
    });
    if (!existingSecret) {
      const envSecret = this.config.get<string>("GOOGLE_CALENDAR_CLIENT_SECRET", "");
      if (envSecret) this.logger.log("Seeding Google Calendar client secret from env (encrypted)");
      const encrypted = envSecret ? encryptSecret(envSecret, this.encryptionKey) : "";
      await this.ensureSetting(AppConfigName.GOOGLE_CALENDAR_CLIENT_SECRET, encrypted);
    }
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
    return this.getSettingValue(
      AppConfigName.STORAGE_FILESYSTEM_ROOT,
      join(process.cwd(), "data", "attachments"),
    );
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

  async getGoogleCalendarClientId(): Promise<string> {
    return this.getSettingValue(AppConfigName.GOOGLE_CALENDAR_CLIENT_ID, "");
  }

  async getGoogleCalendarClientSecret(): Promise<string> {
    const stored = await this.getSettingValue(AppConfigName.GOOGLE_CALENDAR_CLIENT_SECRET, "");
    if (!stored) return "";
    // Encrypted format is "iv.tag.ciphertext" — all three segments are hex strings
    const parts = stored.split(".");
    const isEncrypted = parts.length === 3 && parts.every((p: string) => /^[0-9a-f]+$/i.test(p));
    if (isEncrypted) {
      try {
        return decryptSecret(stored, this.encryptionKey);
      } catch (error) {
        this.logger.error(`Failed to decrypt Google Calendar client secret: ${error}`);
        return "";
      }
    }
    // Legacy plaintext value — encrypt it in place for future reads
    this.logger.warn("Migrating plaintext Google Calendar client secret to encrypted storage");
    await this.setGoogleCalendarClientSecret(stored);
    return stored;
  }

  async setGoogleCalendarClientId(value: string) {
    return this.setSettingValue(AppConfigName.GOOGLE_CALENDAR_CLIENT_ID, value);
  }

  async setGoogleCalendarClientSecret(value: string) {
    const encrypted = value ? encryptSecret(value, this.encryptionKey) : "";
    return this.setSettingValue(AppConfigName.GOOGLE_CALENDAR_CLIENT_SECRET, encrypted);
  }

  async listSettings() {
    await this.ensureSetting(AppConfigName.ACCOUNT_CREATION_ENABLED, "true");
    await this.ensureSetting(AppConfigName.PASSWORD_AUTH_ENABLED, "true");
    await this.ensureSetting(AppConfigName.STORAGE_BACKEND, "filesystem");
    await this.ensureSetting(
      AppConfigName.STORAGE_FILESYSTEM_ROOT,
      join(process.cwd(), "data", "attachments"),
    );
    await this.ensureSetting(AppConfigName.STORAGE_S3_ENDPOINT, "");
    await this.ensureSetting(AppConfigName.STORAGE_S3_BUCKET, "");
    await this.ensureSetting(AppConfigName.STORAGE_S3_ACCESS_KEY_ID, "");
    await this.ensureSetting(AppConfigName.STORAGE_S3_SECRET_ACCESS_KEY, "");

    const settings = await this.prisma.appConfig.findMany({
      orderBy: { name: "asc" },
    });

    return settings.map((setting: AppSettingRecord) => ({
      name: setting.name,
      value: setting.value,
      createdAt: setting.createdAt,
      updatedAt: setting.updatedAt,
    }));
  }
}
