import { Injectable } from "@nestjs/common";
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
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService
  ) {}

  async requireSession(metadata: Metadata) {
    const token = this.extractBearerToken(metadata);
    if (!token) {
      throw authRpcException("Missing authorization token");
    }

    let payload: { sub?: string; kind?: string };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw authRpcException("Invalid or expired session");
    }

    if (!payload?.sub || payload.kind === "refresh") {
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
