import { Injectable, Logger } from "@nestjs/common";
import { AppConfigName } from "@slate/server-db";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { SettingsService } from "../settings/settings.service";
import { FilesystemStorageBackend } from "./filesystem-storage.backend";
import { S3StorageBackend, type S3Config } from "./s3-storage.backend";
import type { StorageBackend } from "./storage-backend.interface";

function defaultFilesystemRoot(): string {
  return join(process.cwd(), "data", "attachments");
}

function canCreateDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private backend: StorageBackend | null = null;
  private backendType: string | null = null;

  constructor(private readonly settings: SettingsService) {}

  private async ensureBackend(): Promise<StorageBackend> {
    if (this.backend) return this.backend;
    return this.reinitialize();
  }

  private async buildS3Config(): Promise<S3Config> {
    return {
      endpoint: await this.settings.getStorageS3Endpoint(),
      bucket: await this.settings.getStorageS3Bucket(),
      accessKeyId: await this.settings.getStorageS3AccessKeyId(),
      secretAccessKey: await this.settings.getStorageS3SecretAccessKey(),
    };
  }

  async reinitialize(): Promise<StorageBackend> {
    const type = await this.settings.getSettingValue(AppConfigName.STORAGE_BACKEND, "filesystem");
    this.backendType = type;

    if (type === "s3") {
      const config = await this.buildS3Config();
      this.backend = new S3StorageBackend(config);
      this.logger.log("Initialized S3 storage backend");
    } else {
      let root = await this.settings.getSettingValue(
        AppConfigName.STORAGE_FILESYSTEM_ROOT,
        defaultFilesystemRoot(),
      );
      if (!canCreateDir(root)) {
        const fallback = defaultFilesystemRoot();
        this.logger.warn(`Storage path "${root}" is not writable, falling back to ${fallback}`);
        root = fallback;
        await this.settings.setSettingValue(AppConfigName.STORAGE_FILESYSTEM_ROOT, root);
      }
      this.backend = new FilesystemStorageBackend(root);
      this.logger.log(`Initialized filesystem storage backend at ${root}`);
    }

    return this.backend;
  }

  async store(key: string, data: Buffer, contentType: string): Promise<void> {
    const backend = await this.ensureBackend();
    await backend.put(key, data, contentType);
  }

  async retrieve(key: string): Promise<Readable> {
    const backend = await this.ensureBackend();
    return backend.get(key);
  }

  async remove(key: string): Promise<void> {
    const backend = await this.ensureBackend();
    await backend.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const backend = await this.ensureBackend();
    return backend.exists(key);
  }

  async listKeys(prefix: string): Promise<string[]> {
    const backend = await this.ensureBackend();
    return backend.listKeys(prefix);
  }

  async getActiveBackendType(): Promise<string> {
    if (this.backendType) return this.backendType;
    return this.settings.getSettingValue(AppConfigName.STORAGE_BACKEND, "filesystem");
  }

  async getBackendForType(type: string): Promise<StorageBackend> {
    if (type === "s3") {
      const config = await this.buildS3Config();
      return new S3StorageBackend(config);
    }
    const root = await this.settings.getSettingValue(
      AppConfigName.STORAGE_FILESYSTEM_ROOT,
      defaultFilesystemRoot(),
    );
    return new FilesystemStorageBackend(root);
  }
}
