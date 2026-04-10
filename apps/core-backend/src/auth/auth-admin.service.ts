import pino from "pino";
import type { PrismaClient } from "@slate/server-db";
import { AuthIdentityType } from "@slate/server-db";
import { hash, verify } from "argon2";
import { unauthorized, forbidden, conflict } from "../lib/errors";
import type { AppConfig } from "../lib/types";

export class AuthAdminService {
  private readonly logger = pino({ name: "AuthAdminService" });

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly jwtSign: (payload: object, options?: object) => string,
    private readonly jwtVerify: (token: string) => Promise<any>,
    private readonly createPasswordAccount: (payload: {
      email: string;
      password: string;
      displayName: string;
      isAdmin?: boolean;
    }) => Promise<{
      userId: string;
      tokens: { accessToken: string; refreshToken: string; expiresAtUnix: number };
      email: string;
      displayName: string;
      isAdmin: boolean;
    }>,
    private readonly normalizeUsername: (displayName: string) => string,
    private readonly passwordAuthEnabled: () => Promise<boolean>,
  ) {}

  // -------------------------------------------------------------------------
  // Admin authentication
  // -------------------------------------------------------------------------

  async authenticateAdmin(email: string, password: string) {
    if (!(await this.passwordAuthEnabled())) {
      throw forbidden("Password authentication is disabled");
    }

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
    this.logger.info(`createInternalAdminSession: attempt email=${email}`);
    const user = await this.authenticateAdmin(payload.email, payload.password);
    if (!user) {
      this.logger.warn(`createInternalAdminSession: rejected invalid_credentials email=${email}`);
      throw unauthorized("Invalid admin credentials");
    }

    this.logger.info(`createInternalAdminSession: ok userId=${user.id}`);
    return this.createInternalAdminSessionForUser(user);
  }

  async verifyInternalAdminToken(token: string) {
    let payload: { sub?: string; kind?: string };
    try {
      payload = await this.jwtVerify(token);
    } catch (err) {
      const name = err instanceof Error ? err.name : "unknown";
      this.logger.warn(
        `verifyInternalAdminToken: rejected reason=jwt_verify_failed jwtError=${name}`,
      );
      throw unauthorized("Invalid admin session");
    }

    if (!payload?.sub || payload.kind !== "internal-admin") {
      this.logger.warn(
        `verifyInternalAdminToken: rejected reason=invalid_admin_payload hasSub=${Boolean(payload?.sub)} kind=${payload?.kind ?? "absent"}`,
      );
      throw unauthorized("Invalid admin session");
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
      throw unauthorized("Admin session is no longer valid");
    }

    return user;
  }

  // -------------------------------------------------------------------------
  // Initial setup
  // -------------------------------------------------------------------------

  async setupInitialAdmin(payload: { email: string; password: string; displayName: string }) {
    const userCount = await this.prisma.user.count();
    if (userCount > 0) {
      throw forbidden("Initial admin setup is no longer available");
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

  // -------------------------------------------------------------------------
  // Admin-managed user CRUD
  // -------------------------------------------------------------------------

  async upsertAdminManagedUser(
    userId: string | null,
    payload: { email: string; displayName: string; password?: string; isAdmin: boolean },
  ) {
    const email = payload.email.trim().toLowerCase();
    const displayName = payload.displayName.trim();
    const normalizedUsername = this.normalizeUsername(displayName);

    if (!email || !displayName) {
      throw conflict("Email and username are required");
    }

    const existingEmail = await this.prisma.user.findUnique({ where: { email } });
    if (existingEmail && existingEmail.id !== userId) {
      throw conflict("An account with this email already exists");
    }

    const existingUsername = await this.prisma.user.findUnique({ where: { normalizedUsername } });
    if (existingUsername && existingUsername.id !== userId) {
      throw conflict("This username is already taken");
    }

    if (!userId && (!payload.password || payload.password.length < 8)) {
      throw conflict("Password must be at least 8 characters");
    }

    await this.assertCanChangeAdminRole(userId, payload.isAdmin);

    const passwordHash =
      payload.password && payload.password.length >= 8 ? await hash(payload.password) : undefined;

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

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private createInternalAdminSessionForUser(user: {
    id: string;
    email: string;
    displayName: string;
    isAdmin: boolean;
  }) {
    if (!user.isAdmin) {
      throw unauthorized("Invalid admin credentials");
    }

    const accessToken = this.jwtSign({ sub: user.id, kind: "internal-admin" }, { expiresIn: "8h" });
    return {
      accessToken,
      user,
      expiresAtUnix: Math.floor(Date.now() / 1000) + 8 * 3600,
    };
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

    const records = await this.prisma.authIdentity.findMany({
      where: {
        type: AuthIdentityType.OIDC,
        lastUsedAt: { not: null },
        user: { isAdmin: true },
      },
      select: { userId: true },
      distinct: ["userId"],
    });
    if (records.length <= 1) {
      throw conflict(
        "Cannot remove admin role: at least one admin with an OIDC login is required while password auth is disabled",
      );
    }
  }
}
