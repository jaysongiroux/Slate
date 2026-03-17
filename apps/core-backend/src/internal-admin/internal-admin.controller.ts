import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../auth/auth.service";
import { SettingsService } from "../settings/settings.service";
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
  constructor(
    private readonly authService: AuthService,
    private readonly settingsService: SettingsService,
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
    return this.authService.startAdminOidc(payload.providerId, payload.redirectUri);
  }

  @Post("auth/oidc/complete")
  completeAdminOidc(@Body() payload: { providerId?: string; redirectUri: string; state: string; code: string }) {
    return this.authService.completeAdminOidc(payload);
  }

  @Post("setup-initial")
  setupInitialAdmin(@Body() payload: { email: string; password: string; displayName: string }) {
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
}
