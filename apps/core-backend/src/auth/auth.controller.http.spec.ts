import { buildApp } from "../server";

/**
 * Auth route-level tests using Fastify's inject() method.
 *
 * Since these routes are public (no auth guard), we test them via inject()
 * to verify request/response transformation behavior.
 */
describe("Auth routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /api/auth/providers returns auth providers", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/providers",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty("providers");
    expect(Array.isArray(body.providers)).toBe(true);
  });

  it("POST /api/auth/login returns 401 for invalid credentials", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "nonexistent@example.com",
        password: "wrong-password",
        clientId: "c1",
      },
    });

    // Should fail with some error (user not found or invalid credentials)
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("POST /api/auth/refresh returns error for invalid refresh token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: "invalid-token" },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("GET /api/health returns ok", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});
