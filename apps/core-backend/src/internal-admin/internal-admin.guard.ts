import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../auth/auth.service";

@Injectable()
export class InternalAdminGuard implements CanActivate {
  private readonly logger = new Logger(InternalAdminGuard.name);

  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { adminUser?: unknown }>();
    const token = this.extractBearerToken(request);
    if (!token) {
      this.logger.warn("InternalAdminGuard: rejected reason=missing_bearer_token");
      throw new UnauthorizedException("Missing admin authorization token");
    }

    const adminUser = await this.authService.verifyInternalAdminToken(token);
    request.adminUser = adminUser;
    return true;
  }

  private extractBearerToken(request: Request) {
    const raw = request.headers.authorization;
    if (!raw) {
      return null;
    }

    const match = raw.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
  }
}
