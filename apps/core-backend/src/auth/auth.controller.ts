import { Controller, Get, Post, Body, HttpCode, HttpStatus, Logger } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Get("api/auth/providers")
  async listProvidersHttp() {
    return this.authService.listProviders();
  }

  @Post("api/auth/login")
  @HttpCode(HttpStatus.OK)
  async loginWithPasswordHttp(
    @Body() body: { email: string; password: string; totpCode?: string; clientId?: string },
  ) {
    return this.authService.loginWithPassword({
      email: body.email,
      password: body.password,
      totpCode: body.totpCode,
      clientId: body.clientId ?? "desktop",
    });
  }

  @Post("api/auth/refresh")
  @HttpCode(HttpStatus.OK)
  async refreshTokensHttp(@Body() body: { refreshToken: string }) {
    return this.authService.refreshTokens(body.refreshToken);
  }

  @Post("api/auth/oidc/start")
  @HttpCode(HttpStatus.OK)
  async startOidcHttp(
    @Body() body: { providerId: string; redirectUri: string; clientId?: string },
  ) {
    return this.authService.startOidc(
      body.providerId,
      body.redirectUri,
      body.clientId ?? "desktop",
      false,
    );
  }

  @Post("api/auth/oidc/complete")
  @HttpCode(HttpStatus.OK)
  async completeOidcHttp(
    @Body()
    body: {
      providerId?: string;
      redirectUri: string;
      state: string;
      code: string;
      clientId?: string;
    },
  ) {
    return this.authService.completeOidc({
      providerId: body.providerId,
      redirectUri: body.redirectUri,
      state: body.state,
      code: body.code,
      clientId: body.clientId ?? "desktop",
    });
  }

  @Get("api/health")
  health() {
    return { ok: true };
  }
}
