import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthSessionService } from "./auth-session.service";
import { HttpAuthGuard } from "./http-auth.guard";

describe("AuthController HTTP endpoints", () => {
  let controller: AuthController;
  let authService: jest.Mocked<Partial<AuthService>>;

  const fakeTokens = { accessToken: "at", refreshToken: "rt", expiresAtUnix: 9999 };

  beforeEach(async () => {
    authService = {
      listProviders: jest.fn().mockResolvedValue({ providers: [] }),
      loginWithPassword: jest.fn().mockResolvedValue({
        userId: "u1",
        tokens: fakeTokens,
        email: "a@b.com",
        displayName: "A",
        isAdmin: false,
      }),
      refreshTokens: jest.fn().mockResolvedValue(fakeTokens),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: AuthSessionService, useValue: { validateAccessToken: jest.fn() } },
        { provide: HttpAuthGuard, useValue: { canActivate: () => true } },
      ],
    })
      .overrideGuard(HttpAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it("listProvidersHttp returns auth providers", async () => {
    const result = await controller.listProvidersHttp();
    expect(authService.listProviders).toHaveBeenCalled();
    expect(result).toEqual({ providers: [] });
  });

  it("loginWithPasswordHttp returns tokens", async () => {
    const result = await controller.loginWithPasswordHttp({
      email: "a@b.com",
      password: "pw",
      clientId: "c1",
    });
    expect(result).toMatchObject({ userId: "u1", tokens: fakeTokens });
  });

  it("refreshTokensHttp returns new tokens", async () => {
    const result = await controller.refreshTokensHttp({ refreshToken: "old-rt" });
    expect(result).toEqual(fakeTokens);
  });

  it("health returns ok", () => {
    const result = controller.health();
    expect(result).toEqual({ ok: true });
  });
});
