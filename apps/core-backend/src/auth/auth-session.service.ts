import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { RpcException } from "@nestjs/microservices";
import { status } from "@grpc/grpc-js";
import { Metadata } from "@grpc/grpc-js";
import { PrismaService } from "../prisma/prisma.service";

function authRpcException(message: string, code = status.UNAUTHENTICATED) {
  return new RpcException({ code, message });
}

@Injectable()
export class AuthSessionService {
  private readonly logger = new Logger(AuthSessionService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async requireSession(metadata: Metadata) {
    const token = this.extractBearerToken(metadata);
    if (!token) {
      this.logger.warn("requireSession: rejected reason=missing_bearer_token");
      throw authRpcException("Missing authorization token");
    }

    let payload: { sub?: string; kind?: string };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch (err) {
      const name = err instanceof Error ? err.name : "unknown";
      this.logger.warn(`requireSession: rejected reason=jwt_verify_failed jwtError=${name}`);
      throw authRpcException("Invalid or expired session");
    }

    if (!payload?.sub || payload.kind === "refresh") {
      this.logger.warn(
        `requireSession: rejected reason=invalid_access_payload hasSub=${Boolean(payload?.sub)} kind=${payload?.kind ?? "absent"}`,
      );
      throw authRpcException("Invalid session payload");
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

    if (!user) {
      this.logger.warn(`requireSession: rejected reason=user_not_found userId=${payload.sub}`);
      throw authRpcException("Session is no longer valid");
    }

    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
    };
  }

  extractBearerToken(metadata: Metadata) {
    const raw = metadata.get("authorization")[0];
    if (typeof raw !== "string") {
      return null;
    }

    const match = raw.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
  }
}
