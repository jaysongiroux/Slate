import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { HttpAuthGuard } from "./http-auth.guard";
import { AuthSessionService } from "./auth-session.service";

describe("HttpAuthGuard", () => {
  let guard: HttpAuthGuard;
  let authSession: jest.Mocked<Pick<AuthSessionService, "validateAccessToken">>;

  beforeEach(() => {
    authSession = { validateAccessToken: jest.fn() };
    guard = new HttpAuthGuard(authSession as any);
  });

  function makeContext(authHeader?: string): ExecutionContext {
    const request: any = {
      headers: authHeader ? { authorization: authHeader } : {},
      user: undefined,
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
  }

  it("sets request.user and returns true for a valid Bearer token", async () => {
    const user = { userId: "u1", email: "a@b.com", displayName: "A", isAdmin: false };
    authSession.validateAccessToken.mockResolvedValue(user as any);
    const ctx = makeContext("Bearer valid-jwt");
    expect(await guard.canActivate(ctx)).toBe(true);
    expect((ctx.switchToHttp().getRequest() as any).user).toEqual(user);
  });

  it("throws UnauthorizedException when Authorization header is absent", async () => {
    await expect(guard.canActivate(makeContext())).rejects.toThrow(UnauthorizedException);
  });

  it("throws UnauthorizedException when header has no Bearer prefix", async () => {
    await expect(guard.canActivate(makeContext("basic abc"))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("throws UnauthorizedException when validateAccessToken rejects", async () => {
    authSession.validateAccessToken.mockRejectedValue(new Error("expired"));
    await expect(guard.canActivate(makeContext("Bearer bad"))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
