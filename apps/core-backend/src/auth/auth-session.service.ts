import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuthSessionService {
  private readonly logger = new Logger(AuthSessionService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Validate a raw JWT access token for HTTP/WebSocket contexts.
   */
  async validateAccessToken(token: string) {
    let payload: { sub?: string; kind?: string };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch (err) {
      const name = err instanceof Error ? err.name : "unknown";
      this.logger.warn(`validateAccessToken: rejected reason=jwt_verify_failed jwtError=${name}`);
      throw new Error("Invalid or expired token");
    }

    if (!payload?.sub || payload.kind === "refresh") {
      throw new Error("Invalid token payload");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, displayName: true, isAdmin: true },
    });

    if (!user) {
      throw new Error("User not found");
    }

    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
    };
  }
}
