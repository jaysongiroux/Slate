import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { verify } from "argon2";
import * as OTPAuth from "otpauth";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService
  ) {}

  async listProviders() {
    return {
      providers: [
        { id: "password", label: "Email and Password", type: "password" },
        { id: "google", label: "Google", type: "oidc" }
      ]
    };
  }

  async loginWithPassword(payload: { email: string; password: string; totpCode?: string; clientId: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: payload.email },
      include: {
        memberships: true,
        totpEnrollment: true
      }
    });

    if (!user?.passwordHash || !(await verify(user.passwordHash, payload.password))) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (user.totpEnrollment?.enabled) {
      const totp = new OTPAuth.TOTP({ secret: user.totpEnrollment.secretBase32, algorithm: "SHA1", digits: 6 });
      const delta = totp.validate({ token: payload.totpCode ?? "", window: 1 });
      if (delta === null) {
        throw new UnauthorizedException("Invalid TOTP code");
      }
    }

    const membership = user.memberships[0];
    if (!membership) {
      throw new UnauthorizedException("User has no workspace");
    }

    return {
      userId: user.id,
      workspaceId: membership.workspaceId,
      tokens: this.issueTokens(user.id, membership.workspaceId)
    };
  }

  async startOidc(providerId: string, redirectUri: string) {
    return {
      authorizationUrl: `https://example.com/oauth/${providerId}?redirect_uri=${encodeURIComponent(redirectUri)}`,
      state: crypto.randomUUID()
    };
  }

  private issueTokens(userId: string, workspaceId: string) {
    const payload = { sub: userId, workspaceId };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign({ ...payload, kind: "refresh" }, { expiresIn: "30d" });

    return {
      accessToken,
      refreshToken,
      expiresAtUnix: Math.floor(Date.now() / 1000) + 3600
    };
  }
}

