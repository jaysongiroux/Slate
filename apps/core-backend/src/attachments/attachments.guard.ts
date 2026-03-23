import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";

export type AttachmentRequest = Request & {
  userSession?: {
    userId: string;
  };
};

@Injectable()
export class AttachmentsGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AttachmentRequest>();
    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException("Missing authorization token");
    }

    let payload: { sub?: string; kind?: string };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired session");
    }

    if (!payload?.sub || payload.kind === "refresh") {
      throw new UnauthorizedException("Invalid session payload");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true },
    });

    if (!user) {
      throw new UnauthorizedException("Session is no longer valid");
    }

    request.userSession = {
      userId: payload.sub,
    };

    return true;
  }

  private extractBearerToken(request: Request) {
    const raw = request.headers.authorization;
    if (raw) {
      const match = raw.match(/^Bearer\s+(.+)$/i);
      if (match) return match[1];
    }

    // Fall back to query param for contexts that can't set headers (e.g. <img src>)
    const queryToken = request.query?.token;
    if (typeof queryToken === "string" && queryToken.length > 0) {
      return queryToken;
    }

    return null;
  }
}
