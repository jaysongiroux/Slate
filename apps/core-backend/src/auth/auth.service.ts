import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthIdentityType } from "@slate/server-db";
import { hash, verify } from "argon2";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";

type OidcMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint?: string;
  jwksUri: string;
};

type OidcTokenResponse = {
  access_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly oidcMetadataCache = new Map<string, { metadata: OidcMetadata; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly settingsService: SettingsService,
  ) {}

  async listProviders() {
    const providers: Array<{ id: string; label: string; type: string; accountCreationEnabled?: boolean }> = [];
    const accountCreationEnabled = await this.accountCreationEnabled();

    if (await this.passwordAuthEnabled()) {
      providers.push({ id: "password", label: "Email and Password", type: "password", accountCreationEnabled });
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

  async listPublicOidcProviders() {
    return this.prisma.oidcProviderConfig.findMany({
      where: { enabled: true },
      orderBy: [{ label: "asc" }, { providerId: "asc" }],
      select: { providerId: true, label: true },
    });
  }

  async listOidcProviderConfigs() {
    const providers = await this.prisma.oidcProviderConfig.findMany({
      orderBy: [{ createdAt: "asc" }],
    });

    return providers.map((provider) => ({
      providerId: provider.providerId,
      label: provider.label,
      issuerUrl: provider.issuerUrl,
      clientId: provider.clientId,
      scopes: provider.scopes,
      enabled: provider.enabled,
      hasClientSecret: Boolean(provider.clientSecretEncrypted),
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    }));
  }

  async createOidcProviderConfig(payload: {
    providerId: string;
    label: string;
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    scopes?: string;
    enabled?: boolean;
  }) {
    const providerId = this.normalizeProviderId(payload.providerId);
    const label = payload.label.trim();
    const issuerUrl = this.normalizeIssuerUrl(payload.issuerUrl);
    const clientId = payload.clientId.trim();
    const clientSecret = payload.clientSecret.trim();
    const scopes = this.normalizeScopes(payload.scopes);

    if (!providerId || !label || !issuerUrl || !clientId || !clientSecret) {
      throw new ConflictException("providerId, label, issuerUrl, clientId, and clientSecret are required");
    }

    const existingCaseInsensitive = await this.prisma.oidcProviderConfig.findFirst({
      where: {
        providerId: {
          equals: providerId,
          mode: "insensitive",
        },
      },
      select: { providerId: true },
    });
    if (existingCaseInsensitive) {
      throw new ConflictException(`OIDC provider '${existingCaseInsensitive.providerId}' already exists`);
    }

    const created = await this.prisma.oidcProviderConfig.create({
      data: {
        providerId,
        label,
        issuerUrl,
        clientId,
        clientSecretEncrypted: this.encryptSecret(clientSecret),
        scopes,
        enabled: payload.enabled ?? true,
      },
    });

    return {
      providerId: created.providerId,
      label: created.label,
      issuerUrl: created.issuerUrl,
      clientId: created.clientId,
      scopes: created.scopes,
      enabled: created.enabled,
      hasClientSecret: true,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  async updateOidcProviderConfig(
    providerIdRaw: string,
    payload: {
      label?: string;
      issuerUrl?: string;
      clientId?: string;
      clientSecret?: string;
      scopes?: string;
      enabled?: boolean;
    },
  ) {
    const providerId = this.normalizeProviderId(providerIdRaw);
    const existing = await this.resolveOidcProviderById(providerId, { notFoundMessage: "OIDC provider not found" });

    const nextEnabled = payload.enabled ?? existing.enabled;
    if (!nextEnabled && existing.enabled) {
      await this.assertProviderCanBeDisabledOrDeleted(existing.providerId);
    }

    const updated = await this.prisma.oidcProviderConfig.update({
      where: { id: existing.id },
      data: {
        ...(payload.label !== undefined ? { label: payload.label.trim() } : {}),
        ...(payload.issuerUrl !== undefined ? { issuerUrl: this.normalizeIssuerUrl(payload.issuerUrl) } : {}),
        ...(payload.clientId !== undefined ? { clientId: payload.clientId.trim() } : {}),
        ...(payload.clientSecret !== undefined && payload.clientSecret.trim().length > 0
          ? { clientSecretEncrypted: this.encryptSecret(payload.clientSecret.trim()) }
          : {}),
        ...(payload.scopes !== undefined ? { scopes: this.normalizeScopes(payload.scopes) } : {}),
        ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
      },
    });

    return {
      providerId: updated.providerId,
      label: updated.label,
      issuerUrl: updated.issuerUrl,
      clientId: updated.clientId,
      scopes: updated.scopes,
      enabled: updated.enabled,
      hasClientSecret: true,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async deleteOidcProviderConfig(providerIdRaw: string) {
    const providerId = this.normalizeProviderId(providerIdRaw);
    const existing = await this.resolveOidcProviderById(providerId, { notFoundMessage: "OIDC provider not found" });

    if (existing.enabled) {
      await this.assertProviderCanBeDisabledOrDeleted(existing.providerId);
    }

    await this.prisma.oidcProviderConfig.delete({ where: { id: existing.id } });
    return { deleted: true };
  }

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

  normalizeUsername(displayName: string) {
    return displayName.trim().toLowerCase();
  }

  validateRegistrationPayload(payload: { email: string; password: string; displayName: string }) {
    const email = payload.email.trim().toLowerCase();
    const displayName = payload.displayName.trim();
    const normalizedUsername = this.normalizeUsername(displayName);

    if (!email || !displayName) {
      throw new ConflictException("Email and username are required");
    }

    if (payload.password.length < 8) {
      throw new ConflictException("Password must be at least 8 characters");
    }

    return { email, displayName, normalizedUsername };
  }

  async loginWithPassword(payload: { email: string; password: string; totpCode?: string; clientId: string }) {
    await this.ensurePasswordAuthEnabled();

    const user = await this.prisma.user.findUnique({
      where: { email: payload.email.trim().toLowerCase() },
      include: { totpEnrollment: true },
    });

    if (!user) {
      throw new UnauthorizedException("No account found for this email. Account creation is managed by an administrator.");
    }

    if (!user.passwordHash || !(await verify(user.passwordHash, payload.password))) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (user.totpEnrollment?.enabled) {
      const totp = new OTPAuth.TOTP({ secret: user.totpEnrollment.secretBase32, algorithm: "SHA1", digits: 6 });
      const delta = totp.validate({ token: payload.totpCode ?? "", window: 1 });
      if (delta === null) {
        throw new UnauthorizedException("Invalid TOTP code");
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

  async registerWithPassword(payload: { email: string; password: string; displayName: string; clientId: string }) {
    await this.ensurePasswordAuthEnabled();

    const userCount = await this.prisma.user.count();
    if (userCount === 0) {
      throw new ForbiddenException("Initial administrator setup must be completed at /admin/setup");
    }

    if (!(await this.accountCreationEnabled())) {
      throw new ForbiddenException("Account creation is disabled on this server");
    }

    return this.createPasswordAccount({
      email: payload.email,
      password: payload.password,
      displayName: payload.displayName,
      isAdmin: false,
    });
  }

  async createPasswordAccount(payload: { email: string; password: string; displayName: string; isAdmin?: boolean }) {
    const { email, displayName, normalizedUsername } = this.validateRegistrationPayload(payload);

    const existingEmail = await this.prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      throw new ConflictException("An account with this email already exists");
    }

    const existingUsername = await this.prisma.user.findUnique({ where: { normalizedUsername } });
    if (existingUsername) {
      throw new ConflictException("This username is already taken");
    }

    const passwordHash = await hash(payload.password);
    const user = await this.prisma.$transaction(async (tx) => {
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

  async authenticateAdmin(email: string, password: string) {
    await this.ensurePasswordAuthEnabled();

    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!user?.isAdmin || !user.passwordHash) {
      return null;
    }

    if (!(await verify(user.passwordHash, password))) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
    };
  }

  async createInternalAdminSession(payload: { email: string; password: string }) {
    const email = payload.email.trim().toLowerCase();
    this.logger.log(`createInternalAdminSession: attempt email=${email}`);
    const user = await this.authenticateAdmin(payload.email, payload.password);
    if (!user) {
      this.logger.warn(`createInternalAdminSession: rejected invalid_credentials email=${email}`);
      throw new UnauthorizedException("Invalid admin credentials");
    }

    this.logger.log(`createInternalAdminSession: ok userId=${user.id}`);
    return this.createInternalAdminSessionForUser(user);
  }

  async verifyInternalAdminToken(token: string) {
    let payload: { sub?: string; kind?: string };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch (err) {
      const name = err instanceof Error ? err.name : "unknown";
      this.logger.warn(
        `verifyInternalAdminToken: rejected reason=jwt_verify_failed jwtError=${name}`,
      );
      throw new UnauthorizedException("Invalid admin session");
    }

    if (!payload?.sub || payload.kind !== "internal-admin") {
      this.logger.warn(
        `verifyInternalAdminToken: rejected reason=invalid_admin_payload hasSub=${Boolean(payload?.sub)} kind=${payload?.kind ?? "absent"}`,
      );
      throw new UnauthorizedException("Invalid admin session");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        displayName: true,
        isAdmin: true,
      },
    });

    if (!user?.isAdmin) {
      this.logger.warn(
        `verifyInternalAdminToken: rejected reason=not_admin_or_missing userId=${payload.sub}`,
      );
      throw new UnauthorizedException("Admin session is no longer valid");
    }

    return user;
  }

  async setupInitialAdmin(payload: { email: string; password: string; displayName: string }) {
    const userCount = await this.prisma.user.count();
    if (userCount > 0) {
      throw new ForbiddenException("Initial admin setup is no longer available");
    }

    return this.createPasswordAccount({
      email: payload.email,
      password: payload.password,
      displayName: payload.displayName,
      isAdmin: true,
    });
  }

  async userCount() {
    return this.prisma.user.count();
  }

  async upsertAdminManagedUser(
    userId: string | null,
    payload: { email: string; displayName: string; password?: string; isAdmin: boolean },
  ) {
    const email = payload.email.trim().toLowerCase();
    const displayName = payload.displayName.trim();
    const normalizedUsername = this.normalizeUsername(displayName);

    if (!email || !displayName) {
      throw new ConflictException("Email and username are required");
    }

    const existingEmail = await this.prisma.user.findUnique({ where: { email } });
    if (existingEmail && existingEmail.id !== userId) {
      throw new ConflictException("An account with this email already exists");
    }

    const existingUsername = await this.prisma.user.findUnique({ where: { normalizedUsername } });
    if (existingUsername && existingUsername.id !== userId) {
      throw new ConflictException("This username is already taken");
    }

    if (!userId && (!payload.password || payload.password.length < 8)) {
      throw new ConflictException("Password must be at least 8 characters");
    }

    await this.assertCanChangeAdminRole(userId, payload.isAdmin);

    const passwordHash = payload.password && payload.password.length >= 8 ? await hash(payload.password) : undefined;

    const user = userId
      ? await this.prisma.user.update({
          where: { id: userId },
          data: {
            email,
            displayName,
            normalizedUsername,
            isAdmin: payload.isAdmin,
            ...(passwordHash ? { passwordHash } : {}),
          },
        })
      : await this.prisma.user.create({
          data: {
            email,
            displayName,
            normalizedUsername,
            isAdmin: payload.isAdmin,
            passwordHash,
          },
        });

    return user;
  }

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

  async refreshTokens(refreshToken: string) {
    if (!refreshToken) {
      this.logger.warn("refreshTokens: rejected reason=missing_refresh_token");
      throw new UnauthorizedException("Missing refresh token");
    }

    let payload: { sub?: string; kind?: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken);
    } catch (err) {
      const name = err instanceof Error ? err.name : "unknown";
      this.logger.warn(
        `refreshTokens: rejected reason=jwt_verify_failed jwtError=${name}`,
      );
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    if (!payload?.sub || payload.kind !== "refresh") {
      this.logger.warn(
        `refreshTokens: rejected reason=invalid_refresh_payload hasSub=${Boolean(payload?.sub)} kind=${payload?.kind ?? "absent"}`,
      );
      throw new UnauthorizedException("Invalid refresh token");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, displayName: true, isAdmin: true },
    });

    if (!user) {
      this.logger.warn(
        `refreshTokens: rejected reason=user_not_found userId=${payload.sub}`,
      );
      throw new UnauthorizedException("User no longer exists");
    }

    const tokens = this.issueTokens(user.id);
    this.logger.log(`refreshTokens: ok userId=${user.id}`);
    return {
      userId: user.id,
      tokens,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
    };
  }

  async startOidc(providerIdRaw: string, redirectUriRaw: string, clientIdRaw = "", isAdmin = false) {
    const providerId = this.normalizeProviderId(providerIdRaw);
    const redirectUri = redirectUriRaw.trim();
    const clientId = clientIdRaw.trim() || (isAdmin ? "admin-portal" : "desktop-client");

    if (!redirectUri) {
      throw new BadRequestException("redirectUri is required");
    }

    this.logger.log(`OIDC start: providerId=${providerId}, isAdmin=${isAdmin}, clientId=${clientId}`);
    const provider = await this.getEnabledProvider(providerId);
    const metadata = await this.getOidcMetadata(provider.issuerUrl);
    const state = randomUUID();
    const nonce = this.base64Url(randomBytes(32));
    const codeVerifier = this.base64Url(randomBytes(32));
    const codeChallenge = this.base64Url(createHash("sha256").update(codeVerifier).digest());

    await this.prisma.oidcAuthRequest.create({
      data: {
        state,
        providerId,
        redirectUri,
        codeVerifier,
        nonce,
        clientId,
        isAdmin,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const authorizationUrl = new URL(metadata.authorizationEndpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", provider.clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", provider.scopes || "openid profile email");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("nonce", nonce);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    return {
      authorizationUrl: authorizationUrl.toString(),
      state,
    };
  }

  async completeOidc(payload: {
    providerId?: string;
    redirectUri: string;
    state: string;
    code: string;
    clientId?: string;
  }) {
    const resolved = await this.completeOidcFlow({
      state: payload.state,
      code: payload.code,
      redirectUri: payload.redirectUri,
      providerId: payload.providerId,
      clientId: payload.clientId,
      requireAdmin: false,
    });

    return resolved.session;
  }

  async startAdminOidc(providerId: string, redirectUri: string) {
    return this.startOidc(providerId, redirectUri, "admin-portal", true);
  }

  async completeAdminOidc(payload: { redirectUri: string; state: string; code: string; providerId?: string }) {
    const resolved = await this.completeOidcFlow({
      state: payload.state,
      code: payload.code,
      redirectUri: payload.redirectUri,
      providerId: payload.providerId,
      clientId: "admin-portal",
      requireAdmin: true,
    });

    return this.createInternalAdminSessionForUser({
      id: resolved.user.id,
      email: resolved.user.email,
      displayName: resolved.user.displayName,
      isAdmin: resolved.user.isAdmin,
    });
  }

  async countEnabledOidcProviders() {
    return this.prisma.oidcProviderConfig.count({ where: { enabled: true } });
  }

  async countAdminsWithOidcLogins() {
    const records = await this.prisma.authIdentity.findMany({
      where: {
        type: AuthIdentityType.OIDC,
        lastUsedAt: { not: null },
        user: {
          isAdmin: true,
        },
      },
      select: { userId: true },
      distinct: ["userId"],
    });

    return records.length;
  }

  private async assertCanDisablePasswordAuth() {
    const enabledProviderCount = await this.countEnabledOidcProviders();
    if (enabledProviderCount < 1) {
      throw new ConflictException("Cannot disable password auth: at least one enabled OIDC provider is required");
    }

    const adminOidcCount = await this.countAdminsWithOidcLogins();
    if (adminOidcCount < 1) {
      throw new ConflictException("Cannot disable password auth: at least one admin must log in via OIDC first");
    }
  }

  private async assertProviderCanBeDisabledOrDeleted(providerId: string) {
    if (await this.passwordAuthEnabled()) {
      return;
    }

    const enabledCount = await this.countEnabledOidcProviders();
    if (enabledCount <= 1) {
      throw new ConflictException(
        `Cannot disable or delete OIDC provider '${providerId}' while password auth is disabled`,
      );
    }
  }

  private async assertCanChangeAdminRole(userId: string | null, nextIsAdmin: boolean) {
    if (!userId || nextIsAdmin || (await this.passwordAuthEnabled())) {
      return;
    }

    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });

    if (!current?.isAdmin) {
      return;
    }

    const hasOidcLogin = await this.prisma.authIdentity.findFirst({
      where: {
        userId,
        type: AuthIdentityType.OIDC,
        lastUsedAt: { not: null },
      },
      select: { id: true },
    });

    if (!hasOidcLogin) {
      return;
    }

    const adminOidcCount = await this.countAdminsWithOidcLogins();
    if (adminOidcCount <= 1) {
      throw new ConflictException(
        "Cannot remove admin role: at least one admin with an OIDC login is required while password auth is disabled",
      );
    }
  }

  private async completeOidcFlow(payload: {
    state: string;
    code: string;
    redirectUri: string;
    providerId?: string;
    clientId?: string;
    requireAdmin: boolean;
  }) {
    const state = payload.state.trim();
    const code = payload.code.trim();
    const redirectUri = payload.redirectUri.trim();

    if (!state || !code || !redirectUri) {
      throw new BadRequestException("state, code, and redirectUri are required");
    }

    const request = await this.prisma.oidcAuthRequest.findUnique({
      where: { state },
    });

    if (!request || request.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("OIDC state is invalid or expired");
    }

    if (request.redirectUri !== redirectUri) {
      throw new UnauthorizedException("OIDC redirect URI mismatch");
    }

    if (payload.providerId && this.normalizeProviderId(payload.providerId) !== request.providerId) {
      throw new UnauthorizedException("OIDC provider mismatch");
    }

    if (payload.clientId && payload.clientId.trim() && payload.clientId.trim() !== request.clientId) {
      throw new UnauthorizedException("OIDC client mismatch");
    }

    const provider = await this.getEnabledProvider(request.providerId);
    const metadata = await this.getOidcMetadata(provider.issuerUrl);
    const token = await this.exchangeToken({
      metadata,
      providerClientId: provider.clientId,
      providerClientSecret: this.decryptSecret(provider.clientSecretEncrypted),
      code,
      redirectUri,
      codeVerifier: request.codeVerifier,
    });

    if (!token.id_token) {
      throw new UnauthorizedException("OIDC token response missing id_token");
    }

    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    const jwks = createRemoteJWKSet(new URL(metadata.jwksUri));
    const verified = await jwtVerify(token.id_token, jwks, {
      issuer: metadata.issuer,
      audience: provider.clientId,
    });

    const claims = verified.payload as {
      sub?: string;
      nonce?: string;
      email?: string;
      email_verified?: boolean | string;
      name?: string;
      preferred_username?: string;
    };

    const subject = (claims.sub ?? "").trim();
    if (!subject) {
      throw new UnauthorizedException("OIDC token missing subject claim");
    }
    if (claims.nonce !== request.nonce) {
      throw new UnauthorizedException("OIDC nonce mismatch");
    }

    let email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    let emailVerified = claims.email_verified === true || claims.email_verified === "true";

    // Many providers (Keycloak, Azure AD, etc.) omit email_verified from the
    // id_token but return it from the userinfo endpoint. Fall back to userinfo
    // when the id_token doesn't give us a verified email.
    if ((!email || !emailVerified) && token.access_token && metadata.userinfoEndpoint) {
      try {
        const userinfoResponse = await fetch(metadata.userinfoEndpoint, {
          headers: { Authorization: `Bearer ${token.access_token}` },
        });
        if (userinfoResponse.ok) {
          const userinfo = (await userinfoResponse.json()) as {
            email?: string;
            email_verified?: boolean | string;
            name?: string;
            preferred_username?: string;
          };
          if (!email && typeof userinfo.email === "string") {
            email = userinfo.email.trim().toLowerCase();
          }
          if (!emailVerified) {
            emailVerified = userinfo.email_verified === true || userinfo.email_verified === "true";
          }
          this.logger.log(`OIDC userinfo fallback: email=${email}, emailVerified=${emailVerified}`);
        }
      } catch (userinfoError) {
        this.logger.warn(`OIDC userinfo fetch failed: ${userinfoError instanceof Error ? userinfoError.message : userinfoError}`);
      }
    }

    this.logger.log(
      `OIDC claims resolved: sub=${subject}, email=${email}, emailVerified=${emailVerified}, ` +
      `id_token.email_verified=${String(claims.email_verified ?? "absent")}`,
    );

    const displayName =
      (typeof claims.name === "string" && claims.name.trim()) ||
      (typeof claims.preferred_username === "string" && claims.preferred_username.trim()) ||
      (email ? email.split("@")[0] : "User");

    const resolved = await this.resolveOidcIdentity({
      providerId: provider.providerId,
      providerSubject: subject,
      email,
      emailVerified,
      displayName,
    });

    if (payload.requireAdmin && !resolved.user.isAdmin) {
      throw new UnauthorizedException("OIDC account is not an admin");
    }

    await this.prisma.authIdentity.update({
      where: { id: resolved.identityId },
      data: {
        lastUsedAt: new Date(),
        lastLoginAt: new Date(),
        loginCount: { increment: 1 },
      },
    });

    await this.prisma.oidcAuthRequest.delete({ where: { id: request.id } });

    return {
      user: resolved.user,
      session: {
        userId: resolved.user.id,
        tokens: this.issueTokens(resolved.user.id),
        email: resolved.user.email,
        displayName: resolved.user.displayName,
        isAdmin: resolved.user.isAdmin,
      },
    };
  }

  private async resolveOidcIdentity(payload: {
    providerId: string;
    providerSubject: string;
    email: string;
    emailVerified: boolean;
    displayName: string;
  }) {
    const existingIdentity = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: payload.providerId,
          providerSubject: payload.providerSubject,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            isAdmin: true,
          },
        },
      },
    });

    if (existingIdentity) {
      return {
        identityId: existingIdentity.id,
        user: existingIdentity.user,
      };
    }

    if (!payload.email || !payload.emailVerified) {
      throw new UnauthorizedException("OIDC account is not linked and no verified email was provided");
    }

    let user = await this.prisma.user.findUnique({
      where: { email: payload.email },
      select: {
        id: true,
        email: true,
        displayName: true,
        isAdmin: true,
      },
    });

    if (!user) {
      if (!(await this.accountCreationEnabled())) {
        throw new UnauthorizedException("Account creation is disabled on this server");
      }

      const created = await this.createOidcAccount(payload.email, payload.displayName);
      user = {
        id: created.user.id,
        email: created.user.email,
        displayName: created.user.displayName,
        isAdmin: created.user.isAdmin,
      };
    }

    let identityId = "";
    try {
      const createdIdentity = await this.prisma.authIdentity.create({
        data: {
          userId: user.id,
          type: AuthIdentityType.OIDC,
          provider: payload.providerId,
          providerSubject: payload.providerSubject,
        },
        select: { id: true },
      });
      identityId = createdIdentity.id;
    } catch {
      const fallback = await this.prisma.authIdentity.findUnique({
        where: {
          provider_providerSubject: {
            provider: payload.providerId,
            providerSubject: payload.providerSubject,
          },
        },
        select: { id: true, userId: true },
      });

      if (!fallback || fallback.userId !== user.id) {
        throw new ConflictException("OIDC identity is already linked to another account");
      }
      identityId = fallback.id;
    }

    return {
      identityId,
      user,
    };
  }

  private async createOidcAccount(email: string, displayNameRaw: string) {
    const displayName = displayNameRaw.trim() || email.split("@")[0] || "User";
    const baseUsername = this.normalizeUsername(displayName).replace(/[^a-z0-9._-]+/g, "");
    const safeBase = baseUsername || `user-${randomUUID().slice(0, 8)}`;

    let normalizedUsername = safeBase;
    let suffix = 1;
    // Rare collision loop for deterministic username generation.
    while (await this.prisma.user.findUnique({ where: { normalizedUsername } })) {
      normalizedUsername = `${safeBase}${suffix}`;
      suffix += 1;
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        displayName,
        normalizedUsername,
        isAdmin: false,
      },
    });

    return { user };
  }

  private issueTokens(userId: string) {
    const payload = { sub: userId };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign({ ...payload, kind: "refresh" }, { expiresIn: "365d" });

    return {
      accessToken,
      refreshToken,
      expiresAtUnix: Math.floor(Date.now() / 1000) + 3600,
    };
  }

  private createInternalAdminSessionForUser(user: { id: string; email: string; displayName: string; isAdmin: boolean }) {
    if (!user.isAdmin) {
      throw new UnauthorizedException("Invalid admin credentials");
    }

    const accessToken = this.jwtService.sign({ sub: user.id, kind: "internal-admin" }, { expiresIn: "8h" });
    return {
      accessToken,
      user,
      expiresAtUnix: Math.floor(Date.now() / 1000) + 8 * 3600,
    };
  }

  private async ensurePasswordAuthEnabled() {
    if (!(await this.passwordAuthEnabled())) {
      throw new ForbiddenException("Password authentication is disabled");
    }
  }

  private normalizeProviderId(providerIdRaw: string) {
    const providerId = providerIdRaw.trim().toLowerCase();
    if (!providerId) {
      throw new BadRequestException("providerId is required");
    }
    if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(providerId)) {
      throw new BadRequestException("providerId must be 2-63 chars and contain only lowercase letters, numbers, '.', '-', '_' ");
    }
    return providerId;
  }

  private normalizeIssuerUrl(issuerRaw: string) {
    const trimmed = issuerRaw.trim();
    if (!trimmed) {
      throw new BadRequestException("issuerUrl is required");
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new BadRequestException("issuerUrl must be a valid URL");
    }

    if (parsed.protocol !== "https:") {
      throw new BadRequestException("issuerUrl must use https");
    }

    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  }

  private normalizeScopes(scopesRaw?: string) {
    const scopes = (scopesRaw ?? "openid profile email").trim();
    if (!scopes) {
      return "openid profile email";
    }
    return scopes;
  }

  private async getEnabledProvider(providerId: string) {
    return this.resolveOidcProviderById(providerId, {
      requireEnabled: true,
      notFoundMessage: "OIDC provider is not enabled",
    });
  }

  private async resolveOidcProviderById(
    providerId: string,
    options: {
      requireEnabled?: boolean;
      notFoundMessage: string;
    },
  ) {
    const matches = await this.prisma.oidcProviderConfig.findMany({
      where: {
        providerId: {
          equals: providerId,
          mode: "insensitive",
        },
        ...(options.requireEnabled ? { enabled: true } : {}),
      },
      orderBy: [{ providerId: "asc" }, { createdAt: "asc" }],
    });

    if (matches.length === 0) {
      const configured = await this.prisma.oidcProviderConfig.findMany({
        select: { providerId: true, enabled: true },
        orderBy: [{ providerId: "asc" }],
      });
      this.logger.warn(
        `OIDC provider lookup miss for '${providerId}' (requireEnabled=${Boolean(
          options.requireEnabled,
        )}); configured=${configured.map((p) => `${p.providerId}:${p.enabled ? "enabled" : "disabled"}`).join(", ") || "none"}`,
      );
      throw new NotFoundException(options.notFoundMessage);
    }

    const exact = matches.find((candidate) => candidate.providerId === providerId);
    if (exact) {
      this.logger.log(`OIDC provider resolved: providerId=${exact.providerId}, enabled=${exact.enabled}`);
      return exact;
    }

    if (matches.length === 1) {
      this.logger.log(`OIDC provider resolved (case-insensitive): stored=${matches[0].providerId}, queried=${providerId}, enabled=${matches[0].enabled}`);
      return matches[0];
    }

    this.logger.error(
      `OIDC provider lookup ambiguous for '${providerId}'; matches=${matches.map((m) => m.providerId).join(", ")}`,
    );
    throw new ConflictException(
      `Multiple OIDC providers match '${providerId}' case-insensitively; keep a single lowercase providerId`,
    );
  }

  private async getOidcMetadata(issuerUrl: string) {
    const cached = this.oidcMetadataCache.get(issuerUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.metadata;
    }

    const wellKnown = `${issuerUrl.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const response = await fetch(wellKnown);
    if (!response.ok) {
      throw new UnauthorizedException(`Failed to load OIDC metadata for issuer ${issuerUrl}`);
    }

    const payload = (await response.json()) as {
      issuer?: string;
      authorization_endpoint?: string;
      token_endpoint?: string;
      userinfo_endpoint?: string;
      jwks_uri?: string;
    };

    if (
      !payload.issuer ||
      !payload.authorization_endpoint ||
      !payload.token_endpoint ||
      !payload.jwks_uri
    ) {
      throw new UnauthorizedException("OIDC metadata is missing required endpoints");
    }

    const metadata: OidcMetadata = {
      issuer: payload.issuer,
      authorizationEndpoint: payload.authorization_endpoint,
      tokenEndpoint: payload.token_endpoint,
      userinfoEndpoint: payload.userinfo_endpoint,
      jwksUri: payload.jwks_uri,
    };

    this.oidcMetadataCache.set(issuerUrl, {
      metadata,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    return metadata;
  }

  private async exchangeToken(payload: {
    metadata: OidcMetadata;
    providerClientId: string;
    providerClientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }) {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: payload.code,
      redirect_uri: payload.redirectUri,
      client_id: payload.providerClientId,
      client_secret: payload.providerClientSecret,
      code_verifier: payload.codeVerifier,
    });

    const response = await fetch(payload.metadata.tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form,
    });

    if (!response.ok) {
      throw new UnauthorizedException("OIDC token exchange failed");
    }

    return (await response.json()) as OidcTokenResponse;
  }

  private getSecretKey() {
    const raw = process.env.OIDC_SECRET_ENCRYPTION_KEY ?? "local-dev-oidc-secret";
    return createHash("sha256").update(raw).digest();
  }

  private encryptSecret(secret: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.getSecretKey(), iv);
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
  }

  private decryptSecret(encoded: string) {
    const parts = encoded.split(".");
    if (parts.length !== 3) {
      throw new UnauthorizedException("Invalid encrypted OIDC secret format");
    }

    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const encrypted = Buffer.from(parts[2], "hex");

    const decipher = createDecipheriv("aes-256-gcm", this.getSecretKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return plain.toString("utf8");
  }

  private base64Url(bytes: Buffer) {
    return bytes
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }
}
