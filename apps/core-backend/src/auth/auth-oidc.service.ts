import pino from "pino";
import type { PrismaClient } from "@slate/server-db";
import { AuthIdentityType } from "@slate/server-db";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { unauthorized, badRequest, conflict, notFound } from "../lib/errors";
import type { AppConfig } from "../lib/types";
import type { SettingsService } from "../settings/settings.service";
import {
  type OidcMetadataCache,
  type OidcProviderConfigRecord,
  getOidcMetadata,
  exchangeToken,
  verifyIdTokenAndResolveClaims,
  normalizeProviderId,
  normalizeIssuerUrl,
  normalizeScopes,
  encryptSecret,
  decryptSecret,
  base64Url,
} from "./auth-oidc-utils";

export class AuthOidcService {
  private readonly logger = pino({ name: "AuthOidcService" });
  private readonly oidcMetadataCache: OidcMetadataCache = new Map();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly settingsService: SettingsService,
    private readonly jwtSign: (payload: object, options?: object) => string,
    private readonly issueTokens: (userId: string) => {
      accessToken: string;
      refreshToken: string;
      expiresAtUnix: number;
    },
  ) {}

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
    return providers.map((p: OidcProviderConfigRecord) => ({
      providerId: p.providerId,
      label: p.label,
      issuerUrl: p.issuerUrl,
      clientId: p.clientId,
      scopes: p.scopes,
      enabled: p.enabled,
      hasClientSecret: Boolean(p.clientSecretEncrypted),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
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
    const providerId = normalizeProviderId(payload.providerId);
    const label = payload.label.trim();
    const issuerUrl = normalizeIssuerUrl(payload.issuerUrl);
    const clientId = payload.clientId.trim();
    const clientSecret = payload.clientSecret.trim();
    const scopes = normalizeScopes(payload.scopes);

    if (!providerId || !label || !issuerUrl || !clientId || !clientSecret) {
      throw conflict("providerId, label, issuerUrl, clientId, and clientSecret are required");
    }

    const existing = await this.prisma.oidcProviderConfig.findFirst({
      where: { providerId: { equals: providerId, mode: "insensitive" } },
      select: { providerId: true },
    });
    if (existing) {
      throw conflict(`OIDC provider '${existing.providerId}' already exists`);
    }

    const created = await this.prisma.oidcProviderConfig.create({
      data: {
        providerId,
        label,
        issuerUrl,
        clientId,
        clientSecretEncrypted: encryptSecret(clientSecret),
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
    const providerId = normalizeProviderId(providerIdRaw);
    const existing = await this.resolveOidcProviderById(providerId);
    const nextEnabled = payload.enabled ?? existing.enabled;
    if (!nextEnabled && existing.enabled) {
      await this.assertProviderCanBeDisabledOrDeleted(existing.providerId);
    }
    const updated = await this.prisma.oidcProviderConfig.update({
      where: { id: existing.id },
      data: {
        ...(payload.label !== undefined ? { label: payload.label.trim() } : {}),
        ...(payload.issuerUrl !== undefined
          ? { issuerUrl: normalizeIssuerUrl(payload.issuerUrl) }
          : {}),
        ...(payload.clientId !== undefined ? { clientId: payload.clientId.trim() } : {}),
        ...(payload.clientSecret !== undefined && payload.clientSecret.trim().length > 0
          ? { clientSecretEncrypted: encryptSecret(payload.clientSecret.trim()) }
          : {}),
        ...(payload.scopes !== undefined ? { scopes: normalizeScopes(payload.scopes) } : {}),
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
    const providerId = normalizeProviderId(providerIdRaw);
    const existing = await this.resolveOidcProviderById(providerId);
    if (existing.enabled) {
      await this.assertProviderCanBeDisabledOrDeleted(existing.providerId);
    }
    await this.prisma.oidcProviderConfig.delete({ where: { id: existing.id } });
    return { deleted: true };
  }

  async startOidc(
    providerIdRaw: string,
    redirectUriRaw: string,
    clientIdRaw = "",
    isAdmin = false,
  ) {
    const providerId = normalizeProviderId(providerIdRaw);
    const redirectUri = redirectUriRaw.trim();
    const clientId = clientIdRaw.trim() || (isAdmin ? "admin-portal" : "desktop-client");
    if (!redirectUri) throw badRequest("redirectUri is required");

    this.logger.info(
      `OIDC start: providerId=${providerId}, isAdmin=${isAdmin}, clientId=${clientId}`,
    );
    const provider = await this.getEnabledProvider(providerId);
    const metadata = await getOidcMetadata(provider.issuerUrl, this.oidcMetadataCache);
    const state = randomUUID();
    const nonce = base64Url(randomBytes(32));
    const codeVerifier = base64Url(randomBytes(32));
    const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());

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
    return { authorizationUrl: authorizationUrl.toString(), state };
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

  async completeAdminOidc(payload: {
    redirectUri: string;
    state: string;
    code: string;
    providerId?: string;
  }) {
    const resolved = await this.completeOidcFlow({
      state: payload.state,
      code: payload.code,
      redirectUri: payload.redirectUri,
      providerId: payload.providerId,
      clientId: "admin-portal",
      requireAdmin: true,
    });
    const user = resolved.user;
    if (!user.isAdmin) throw unauthorized("Invalid admin credentials");
    const accessToken = this.jwtSign({ sub: user.id, kind: "internal-admin" }, { expiresIn: "8h" });
    return { accessToken, user, expiresAtUnix: Math.floor(Date.now() / 1000) + 8 * 3600 };
  }

  async countEnabledOidcProviders() {
    return this.prisma.oidcProviderConfig.count({ where: { enabled: true } });
  }

  async countAdminsWithOidcLogins() {
    const records = await this.prisma.authIdentity.findMany({
      where: { type: AuthIdentityType.OIDC, lastUsedAt: { not: null }, user: { isAdmin: true } },
      select: { userId: true },
      distinct: ["userId"],
    });
    return records.length;
  }

  // -- Private: OIDC flow internals ------------------------------------------

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
    if (!state || !code || !redirectUri)
      throw badRequest("state, code, and redirectUri are required");

    const request = await this.prisma.oidcAuthRequest.findUnique({ where: { state } });
    if (!request || request.expiresAt.getTime() < Date.now())
      throw unauthorized("OIDC state is invalid or expired");
    if (request.redirectUri !== redirectUri) throw unauthorized("OIDC redirect URI mismatch");
    if (payload.providerId && normalizeProviderId(payload.providerId) !== request.providerId)
      throw unauthorized("OIDC provider mismatch");
    if (payload.clientId && payload.clientId.trim() && payload.clientId.trim() !== request.clientId)
      throw unauthorized("OIDC client mismatch");

    const provider = await this.getEnabledProvider(request.providerId);
    const metadata = await getOidcMetadata(provider.issuerUrl, this.oidcMetadataCache);
    const token = await exchangeToken({
      metadata,
      providerClientId: provider.clientId,
      providerClientSecret: decryptSecret(provider.clientSecretEncrypted),
      code,
      redirectUri,
      codeVerifier: request.codeVerifier,
    });
    if (!token.id_token) throw unauthorized("OIDC token response missing id_token");

    const { subject, email, emailVerified, displayName } = await verifyIdTokenAndResolveClaims({
      idToken: token.id_token,
      accessToken: token.access_token,
      metadata,
      providerClientId: provider.clientId,
      expectedNonce: request.nonce,
      logger: this.logger,
    });

    const resolved = await this.resolveOidcIdentity({
      providerId: provider.providerId,
      providerSubject: subject,
      email,
      emailVerified,
      displayName,
    });

    if (payload.requireAdmin && !resolved.user.isAdmin)
      throw unauthorized("OIDC account is not an admin");

    await this.prisma.authIdentity.update({
      where: { id: resolved.identityId },
      data: { lastUsedAt: new Date(), lastLoginAt: new Date(), loginCount: { increment: 1 } },
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
      include: { user: { select: { id: true, email: true, displayName: true, isAdmin: true } } },
    });
    if (existingIdentity) return { identityId: existingIdentity.id, user: existingIdentity.user };

    if (!payload.email || !payload.emailVerified) {
      throw unauthorized("OIDC account is not linked and no verified email was provided");
    }

    let user = await this.prisma.user.findUnique({
      where: { email: payload.email },
      select: { id: true, email: true, displayName: true, isAdmin: true },
    });
    if (!user) {
      if (!(await this.settingsService.accountCreationEnabled())) {
        throw unauthorized("Account creation is disabled on this server");
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
      const ci = await this.prisma.authIdentity.create({
        data: {
          userId: user.id,
          type: AuthIdentityType.OIDC,
          provider: payload.providerId,
          providerSubject: payload.providerSubject,
        },
        select: { id: true },
      });
      identityId = ci.id;
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
      if (!fallback || fallback.userId !== user.id)
        throw conflict("OIDC identity is already linked to another account");
      identityId = fallback.id;
    }
    return { identityId, user };
  }

  private async createOidcAccount(email: string, displayNameRaw: string) {
    const displayName = displayNameRaw.trim() || email.split("@")[0] || "User";
    const baseUsername = this.normalizeUsername(displayName).replace(/[^a-z0-9._-]+/g, "");
    const safeBase = baseUsername || `user-${randomUUID().slice(0, 8)}`;
    let normalizedUsername = safeBase;
    let suffix = 1;
    while (await this.prisma.user.findUnique({ where: { normalizedUsername } })) {
      normalizedUsername = `${safeBase}${suffix}`;
      suffix += 1;
    }
    const user = await this.prisma.user.create({
      data: { email, displayName, normalizedUsername, isAdmin: false },
    });
    return { user };
  }

  // -- Private: provider resolution -------------------------------------------

  private async getEnabledProvider(providerId: string) {
    return this.resolveOidcProviderById(providerId, {
      requireEnabled: true,
      notFoundMessage: "OIDC provider is not enabled",
    });
  }

  private async resolveOidcProviderById(
    providerId: string,
    options?: { requireEnabled?: boolean; notFoundMessage?: string },
  ) {
    const msg = options?.notFoundMessage ?? "OIDC provider not found";
    const matches = await this.prisma.oidcProviderConfig.findMany({
      where: {
        providerId: { equals: providerId, mode: "insensitive" },
        ...(options?.requireEnabled ? { enabled: true } : {}),
      },
      orderBy: [{ providerId: "asc" }, { createdAt: "asc" }],
    });
    if (matches.length === 0) {
      const configured = await this.prisma.oidcProviderConfig.findMany({
        select: { providerId: true, enabled: true },
        orderBy: [{ providerId: "asc" }],
      });
      this.logger.warn(
        `OIDC provider lookup miss for '${providerId}' (requireEnabled=${Boolean(options?.requireEnabled)}); configured=${configured.map((p: { providerId: string; enabled: boolean }) => `${p.providerId}:${p.enabled ? "enabled" : "disabled"}`).join(", ") || "none"}`,
      );
      throw notFound(msg);
    }
    const exact = matches.find((c: OidcProviderConfigRecord) => c.providerId === providerId);
    if (exact) {
      this.logger.info(
        `OIDC provider resolved: providerId=${exact.providerId}, enabled=${exact.enabled}`,
      );
      return exact;
    }
    if (matches.length === 1) {
      this.logger.info(
        `OIDC provider resolved (case-insensitive): stored=${matches[0].providerId}, queried=${providerId}, enabled=${matches[0].enabled}`,
      );
      return matches[0];
    }
    this.logger.error(
      `OIDC provider lookup ambiguous for '${providerId}'; matches=${matches.map((m: OidcProviderConfigRecord) => m.providerId).join(", ")}`,
    );
    throw conflict(
      `Multiple OIDC providers match '${providerId}' case-insensitively; keep a single lowercase providerId`,
    );
  }

  private normalizeUsername(displayName: string) {
    return displayName.trim().toLowerCase();
  }

  // -- Private: guards --------------------------------------------------------

  private async assertProviderCanBeDisabledOrDeleted(providerId: string) {
    if (await this.settingsService.passwordAuthEnabled()) return;
    const enabledCount = await this.countEnabledOidcProviders();
    if (enabledCount <= 1)
      throw conflict(
        `Cannot disable or delete OIDC provider '${providerId}' while password auth is disabled`,
      );
  }
}
