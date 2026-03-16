import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { AuthService } from "./auth.service";

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @GrpcMethod("AuthService", "ListAuthProviders")
  listAuthProviders() {
    return this.authService.listProviders();
  }

  @GrpcMethod("AuthService", "LoginWithPassword")
  loginWithPassword(payload: { email: string; password: string; totpCode?: string; clientId: string }) {
    return this.authService.loginWithPassword(payload);
  }

  @GrpcMethod("AuthService", "StartOidc")
  startOidc(payload: { providerId: string; redirectUri: string }) {
    return this.authService.startOidc(payload.providerId, payload.redirectUri);
  }
}

