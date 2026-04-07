import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { AuthSessionService } from "./auth-session.service";

@Injectable()
export class HttpAuthGuard implements CanActivate {
  constructor(private readonly authSession: AuthSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Record<string, any>>();
    const header = request["headers"]["authorization"] as string | undefined;
    if (typeof header !== "string") {
      throw new UnauthorizedException("Missing authorization token");
    }
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw new UnauthorizedException("Missing authorization token");
    }
    try {
      request["user"] = await this.authSession.validateAccessToken(match[1]);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
    return true;
  }
}
