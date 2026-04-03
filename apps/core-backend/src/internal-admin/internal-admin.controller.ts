import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AppConfigName } from "@slate/server-db";
import { AuthService } from "../auth/auth.service";
import { JobHandlersService } from "../jobs/job-handlers.service";
import { JobsService } from "../jobs/jobs.service";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { StorageService } from "../storage/storage.service";
import { InternalAdminGuard } from "./internal-admin.guard";

type AdminRequest = Request & {
  adminUser?: {
    id: string;
    email: string;
    displayName: string;
    isAdmin: boolean;
  };
};

@Controller("internal/admin")
export class InternalAdminController {
  private readonly logger = new Logger(InternalAdminController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly settingsService: SettingsService,
    private readonly storageService: StorageService,
    private readonly jobsService: JobsService,
    private readonly jobHandlers: JobHandlersService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("bootstrap-status")
  async bootstrapStatus() {
    const userCount = await this.authService.userCount();
    return {
      userCount,
      requiresInitialSetup: userCount === 0,
    };
  }

  @Post("auth/login")
  login(@Body() payload: { email: string; password: string }) {
    this.logger.log("HTTP POST internal/admin/auth/login");
    return this.authService.createInternalAdminSession(payload);
  }

  @Get("auth/oidc/providers")
  async listPublicOidcProviders() {
    const providers = await this.authService.listPublicOidcProviders();
    const passwordAuthEnabled = await this.settingsService.passwordAuthEnabled();
    return { providers, passwordAuthEnabled };
  }

  @Post("auth/oidc/start")
  startAdminOidc(@Body() payload: { providerId: string; redirectUri: string }) {
    this.logger.log(`HTTP POST internal/admin/auth/oidc/start providerId=${payload.providerId}`);
    return this.authService.startAdminOidc(payload.providerId, payload.redirectUri);
  }

  @Post("auth/oidc/complete")
  completeAdminOidc(
    @Body() payload: { providerId?: string; redirectUri: string; state: string; code: string },
  ) {
    const stateHint = payload.state?.slice(0, 8) ?? "";
    this.logger.log(
      `HTTP POST internal/admin/auth/oidc/complete statePrefix=${stateHint} providerId=${payload.providerId ?? ""}`,
    );
    return this.authService.completeAdminOidc(payload);
  }

  @Post("setup-initial")
  setupInitialAdmin(@Body() payload: { email: string; password: string; displayName: string }) {
    const email = payload.email?.trim().toLowerCase() ?? "";
    this.logger.log(`HTTP POST internal/admin/setup-initial email=${email || "(empty)"}`);
    return this.authService.setupInitialAdmin(payload);
  }

  @UseGuards(InternalAdminGuard)
  @Get("me")
  me(@Req() request: AdminRequest) {
    return request.adminUser;
  }

  @UseGuards(InternalAdminGuard)
  @Get("settings")
  async settings() {
    const accountCreationEnabled = await this.settingsService.accountCreationEnabled();
    const passwordAuthEnabled = await this.settingsService.passwordAuthEnabled();
    const settings = await this.settingsService.listSettings();
    return {
      accountCreationEnabled,
      passwordAuthEnabled,
      settings,
    };
  }

  @UseGuards(InternalAdminGuard)
  @Patch("settings/account-creation-enabled")
  async updateAccountCreationEnabled(@Body() payload: { enabled: boolean }) {
    await this.settingsService.updateAccountCreationEnabled(Boolean(payload.enabled));
    const accountCreationEnabled = await this.settingsService.accountCreationEnabled();
    return { accountCreationEnabled };
  }

  @UseGuards(InternalAdminGuard)
  @Patch("settings/password-auth-enabled")
  async updatePasswordAuthEnabled(@Body() payload: { enabled: boolean }) {
    return this.authService.updatePasswordAuthEnabled(Boolean(payload.enabled));
  }

  @UseGuards(InternalAdminGuard)
  @Get("oidc/providers")
  async listOidcProviders() {
    return {
      providers: await this.authService.listOidcProviderConfigs(),
    };
  }

  @UseGuards(InternalAdminGuard)
  @Post("oidc/providers")
  async createOidcProvider(
    @Body()
    payload: {
      providerId: string;
      label: string;
      issuerUrl: string;
      clientId: string;
      clientSecret: string;
      scopes?: string;
      enabled?: boolean;
    },
  ) {
    return this.authService.createOidcProviderConfig(payload);
  }

  @UseGuards(InternalAdminGuard)
  @Patch("oidc/providers/:providerId")
  async updateOidcProvider(
    @Param("providerId") providerId: string,
    @Body()
    payload: {
      label?: string;
      issuerUrl?: string;
      clientId?: string;
      clientSecret?: string;
      scopes?: string;
      enabled?: boolean;
    },
  ) {
    return this.authService.updateOidcProviderConfig(providerId, payload);
  }

  @UseGuards(InternalAdminGuard)
  @Delete("oidc/providers/:providerId")
  async deleteOidcProvider(@Param("providerId") providerId: string) {
    return this.authService.deleteOidcProviderConfig(providerId);
  }

  @UseGuards(InternalAdminGuard)
  @Post("users")
  async createUser(
    @Body() payload: { email: string; displayName: string; password?: string; isAdmin?: boolean },
  ) {
    const user = await this.authService.upsertAdminManagedUser(null, {
      email: payload.email,
      displayName: payload.displayName,
      password: payload.password,
      isAdmin: Boolean(payload.isAdmin),
    });

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  @UseGuards(InternalAdminGuard)
  @Patch("users/:userId")
  async updateUser(
    @Param("userId") userId: string,
    @Body() payload: { email: string; displayName: string; password?: string; isAdmin?: boolean },
  ) {
    const user = await this.authService.upsertAdminManagedUser(userId, {
      email: payload.email,
      displayName: payload.displayName,
      password: payload.password,
      isAdmin: Boolean(payload.isAdmin),
    });

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  @UseGuards(InternalAdminGuard)
  @Get("storage/config")
  async getStorageConfig() {
    const backend = await this.settingsService.getStorageBackend();
    const filesystemRoot = await this.settingsService.getStorageFilesystemRoot();
    const s3Endpoint = await this.settingsService.getStorageS3Endpoint();
    const s3Bucket = await this.settingsService.getStorageS3Bucket();
    const s3AccessKeyId = await this.settingsService.getStorageS3AccessKeyId();
    return { backend, filesystemRoot, s3Endpoint, s3Bucket, s3AccessKeyId };
  }

  @UseGuards(InternalAdminGuard)
  @Patch("storage/config")
  async updateStorageConfig(
    @Body()
    payload: {
      backend?: string;
      filesystemRoot?: string;
      s3Endpoint?: string;
      s3Bucket?: string;
      s3AccessKeyId?: string;
      s3SecretAccessKey?: string;
    },
  ) {
    if (payload.backend) {
      await this.settingsService.setSettingValue(AppConfigName.STORAGE_BACKEND, payload.backend);
    }
    if (payload.filesystemRoot) {
      await this.settingsService.setSettingValue(
        AppConfigName.STORAGE_FILESYSTEM_ROOT,
        payload.filesystemRoot,
      );
    }
    if (payload.s3Endpoint !== undefined) {
      await this.settingsService.setSettingValue(
        AppConfigName.STORAGE_S3_ENDPOINT,
        payload.s3Endpoint,
      );
    }
    if (payload.s3Bucket !== undefined) {
      await this.settingsService.setSettingValue(AppConfigName.STORAGE_S3_BUCKET, payload.s3Bucket);
    }
    if (payload.s3AccessKeyId !== undefined) {
      await this.settingsService.setSettingValue(
        AppConfigName.STORAGE_S3_ACCESS_KEY_ID,
        payload.s3AccessKeyId,
      );
    }
    if (payload.s3SecretAccessKey !== undefined) {
      await this.settingsService.setSettingValue(
        AppConfigName.STORAGE_S3_SECRET_ACCESS_KEY,
        payload.s3SecretAccessKey,
      );
    }

    await this.storageService.reinitialize();

    return this.getStorageConfig();
  }

  @UseGuards(InternalAdminGuard)
  @Get("calendar/config")
  async getCalendarConfig() {
    const clientId = await this.settingsService.getGoogleCalendarClientId();
    return { clientId, hasClientSecret: Boolean(await this.settingsService.getGoogleCalendarClientSecret()) };
  }

  @UseGuards(InternalAdminGuard)
  @Patch("calendar/config")
  async updateCalendarConfig(
    @Body() payload: { clientId?: string; clientSecret?: string },
  ) {
    if (payload.clientId !== undefined) {
      await this.settingsService.setGoogleCalendarClientId(payload.clientId);
    }
    if (payload.clientSecret !== undefined) {
      await this.settingsService.setGoogleCalendarClientSecret(payload.clientSecret);
    }
    return this.getCalendarConfig();
  }

  @UseGuards(InternalAdminGuard)
  @Post("storage/migrate")
  async migrateStorage(@Body() payload: { fromBackend: string; toBackend: string }) {
    const attachments = await this.prisma.attachment.findMany({
      where: { status: { in: ["uploaded", "processed"] } },
      select: { id: true },
    });

    for (const attachment of attachments) {
      await this.jobsService.enqueue("storage-migrate", {
        attachmentId: attachment.id,
        fromType: payload.fromBackend,
        toType: payload.toBackend,
      });
    }

    return { enqueued: attachments.length };
  }

  @UseGuards(InternalAdminGuard)
  @Post("storage/gc")
  async runGarbageCollection(@Body() payload?: { orphanAfterMs?: number; deleteAfterMs?: number }) {
    await this.jobHandlers.runGarbageCollection({
      orphanAfterMs: payload?.orphanAfterMs ?? 0,
      deleteAfterMs: payload?.deleteAfterMs ?? 0,
    });
    return { ok: true };
  }
}
