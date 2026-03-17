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

    let payload: { sub?: string; workspaceId?: string; kind?: string };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw authRpcException("Invalid or expired session");
    }

    if (!payload?.sub || !payload?.workspaceId || payload.kind === "refresh") {
      throw authRpcException("Invalid session payload");
    }

    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: payload.workspaceId,
          userId: payload.sub,
        },
      },
      include: {
        workspace: true,
        user: true,
      },
    });

    if (!membership) {
      throw authRpcException("Session is no longer valid");
    }

    return {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      email: membership.user.email,
      displayName: membership.user.displayName,
      workspaceName: membership.workspace.name,
      isAdmin: membership.user.isAdmin,
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
