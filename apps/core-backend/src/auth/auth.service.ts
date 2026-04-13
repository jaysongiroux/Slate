import pino from "pino";
import type { PrismaClient } from "@slate/server-db";
import { AuthIdentityType } from "@slate/server-db";
import { hash, verify } from "argon2";
import * as OTPAuth from "otpauth";
import { unauthorized, forbidden, conflict } from "../lib/errors";
import type { AppConfig } from "../lib/types";
import type { SettingsService } from "../settings/settings.service";

export class AuthService {
  private readonly logger = pino({ name: "AuthService" });

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly settingsService: SettingsService,
    private readonly jwtSign: (payload: object, options?: object) => string,
    private readonly jwtVerify: (token: string) => Promise<any>,
  ) {}

  // -------------------------------------------------------------------------
  // Provider listing
  // -------------------------------------------------------------------------

  async listProviders() {
    const providers: Array<{
      id: string;
      label: string;
      type: string;
      accountCreationEnabled?: boolean;
    }> = [];
    const accountCreationEnabled = await this.accountCreationEnabled();

    if (await this.passwordAuthEnabled()) {
      providers.push({
        id: "password",
        label: "Email and Password",
        type: "password",
        accountCreationEnabled,
      });
    }

    const oidcProviders = await this.prisma.oidcProviderConfig.findMany({
      where: { enabled: true },
      orderBy: [{ label: "asc" }, { providerId: "asc" }],
      select: { providerId: true, label: true },
    });

    for (const provider of oidcProviders) {
      providers.push({ id: provider.providerId, label: provider.label, type: "oidc" });
    }

    return { providers };
  }

  // -------------------------------------------------------------------------
  // Password auth
  // -------------------------------------------------------------------------

  async loginWithPassword(payload: {
    email: string;
    password: string;
    totpCode?: string;
    clientId: string;
  }) {
    await this.ensurePasswordAuthEnabled();

    const user = await this.prisma.user.findUnique({
      where: { email: payload.email.trim().toLowerCase() },
      include: { totpEnrollment: true },
    });

    if (!user) {
      throw unauthorized(
        "No account found for this email. Account creation is managed by an administrator.",
      );
    }

    if (!user.passwordHash || !(await verify(user.passwordHash, payload.password))) {
      throw unauthorized("Invalid credentials");
    }

    if (user.totpEnrollment?.enabled) {
      const totp = new OTPAuth.TOTP({
        secret: user.totpEnrollment.secretBase32,
        algorithm: "SHA1",
        digits: 6,
      });
      const delta = totp.validate({ token: payload.totpCode ?? "", window: 1 });
      if (delta === null) {
        throw unauthorized("Invalid TOTP code");
      }
    }

    return {
      userId: user.id,
      tokens: this.issueTokens(user.id),
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
    };
  }

  async registerWithPassword(payload: {
    email: string;
    password: string;
    displayName: string;
    clientId: string;
  }) {
    await this.ensurePasswordAuthEnabled();

    const userCount = await this.prisma.user.count();
    if (userCount === 0) {
      throw forbidden("Initial administrator setup must be completed at /admin/setup");
    }

    if (!(await this.accountCreationEnabled())) {
      throw forbidden("Account creation is disabled on this server");
    }

    return this.createPasswordAccount({
      email: payload.email,
      password: payload.password,
      displayName: payload.displayName,
      isAdmin: false,
    });
  }

  async createPasswordAccount(payload: {
    email: string;
    password: string;
    displayName: string;
    isAdmin?: boolean;
  }) {
    const { email, displayName, normalizedUsername } = this.validateRegistrationPayload(payload);

    const existingEmail = await this.prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      throw conflict("An account with this email already exists");
    }

    const existingUsername = await this.prisma.user.findUnique({ where: { normalizedUsername } });
    if (existingUsername) {
      throw conflict("This username is already taken");
    }

    const passwordHash = await hash(payload.password);
    const user = await this.prisma.$transaction(async (tx: { user: PrismaClient["user"] }) => {
      const createdUser = await tx.user.create({
        data: {
          email,
          displayName,
          normalizedUsername,
          passwordHash,
          isAdmin: payload.isAdmin ?? false,
        },
      });

      return createdUser;
    });

    return {
      userId: user.id,
      tokens: this.issueTokens(user.id),
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
    };
  }

  // -------------------------------------------------------------------------
  // Token management (public -- used by AuthOidcService via callback)
  // -------------------------------------------------------------------------

  issueTokens(userId: string) {
    const payload = { sub: userId };
    const accessToken = this.jwtSign(payload);
    const refreshToken = this.jwtSign({ ...payload, kind: "refresh" }, { expiresIn: "365d" });

    return {
      accessToken,
      refreshToken,
      expiresAtUnix: Math.floor(Date.now() / 1000) + 3600,
    };
  }

  async refreshTokens(refreshToken: string) {
    if (!refreshToken) {
      this.logger.warn("refreshTokens: rejected reason=missing_refresh_token");
      throw unauthorized("Missing refresh token");
    }

    let payload: { sub?: string; kind?: string };
    try {
      payload = await this.jwtVerify(refreshToken);
    } catch (err) {
      const name = err instanceof Error ? err.name : "unknown";
      this.logger.warn(`refreshTokens: rejected reason=jwt_verify_failed jwtError=${name}`);
      throw unauthorized("Invalid or expired refresh token");
    }

    if (!payload?.sub || payload.kind !== "refresh") {
      this.logger.warn(
        `refreshTokens: rejected reason=invalid_refresh_payload hasSub=${Boolean(payload?.sub)} kind=${payload?.kind ?? "absent"}`,
      );
      throw unauthorized("Invalid refresh token");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, displayName: true, isAdmin: true },
    });

    if (!user) {
      this.logger.warn(`refreshTokens: rejected reason=user_not_found userId=${payload.sub}`);
      throw unauthorized("User no longer exists");
    }

    const tokens = this.issueTokens(user.id);
    this.logger.info(`refreshTokens: ok userId=${user.id}`);
    return {
      userId: user.id,
      tokens,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
    };
  }

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  getCurrentSession(session: {
    userId: string;
    email: string;
    displayName: string;
    isAdmin: boolean;
  }) {
    return {
      userId: session.userId,
      email: session.email,
      displayName: session.displayName,
      isAdmin: session.isAdmin,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  normalizeUsername(displayName: string) {
    return displayName.trim().toLowerCase();
  }

  validateRegistrationPayload(payload: { email: string; password: string; displayName: string }) {
    const email = payload.email.trim().toLowerCase();
    const displayName = payload.displayName.trim();
    const normalizedUsername = this.normalizeUsername(displayName);

    if (!email || !displayName) {
      throw conflict("Email and username are required");
    }

    if (payload.password.length < 8) {
      throw conflict("Password must be at least 8 characters");
    }

    return { email, displayName, normalizedUsername };
  }

  // -------------------------------------------------------------------------
  // Settings delegates
  // -------------------------------------------------------------------------

  async accountCreationEnabled() {
    return this.settingsService.accountCreationEnabled();
  }

  async passwordAuthEnabled() {
    return this.settingsService.passwordAuthEnabled();
  }

  async updatePasswordAuthEnabled(enabled: boolean) {
    if (!enabled) {
      await this.assertCanDisablePasswordAuth();
    }

    await this.settingsService.updatePasswordAuthEnabled(enabled);
    return { passwordAuthEnabled: await this.passwordAuthEnabled() };
  }

  private async ensurePasswordAuthEnabled() {
    if (!(await this.passwordAuthEnabled())) {
      throw forbidden("Password authentication is disabled");
    }
  }

  // -------------------------------------------------------------------------
  // Password-auth disable guard (needs OIDC counts)
  // -------------------------------------------------------------------------

  private async assertCanDisablePasswordAuth() {
    const enabledProviderCount = await this.prisma.oidcProviderConfig.count({
      where: { enabled: true },
    });
    if (enabledProviderCount < 1) {
      throw conflict(
        "Cannot disable password auth: at least one enabled OIDC provider is required",
      );
    }

    const records = await this.prisma.authIdentity.findMany({
      where: {
        type: AuthIdentityType.OIDC,
        lastUsedAt: { not: null },
        user: { isAdmin: true },
      },
      select: { userId: true },
      distinct: ["userId"],
    });
    if (records.length < 1) {
      throw conflict("Cannot disable password auth: at least one admin must log in via OIDC first");
    }
  }
}
