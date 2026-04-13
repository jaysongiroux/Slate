import pino from "pino";
import type { PrismaClient } from "@slate/server-db";

export class AuthSessionService {
  private readonly logger = pino({ name: "AuthSessionService" });

  constructor(
    private readonly jwtVerify: (token: string) => Promise<{ sub?: string; kind?: string }>,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * Validate a raw JWT access token for HTTP/WebSocket contexts.
   */
  async validateAccessToken(token: string) {
    let payload: { sub?: string; kind?: string };
    try {
      payload = await this.jwtVerify(token);
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
