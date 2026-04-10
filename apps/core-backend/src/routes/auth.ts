import type { FastifyInstance } from "fastify";

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.get("/api/auth/providers", async () => {
    return fastify.authService.listProviders();
  });

  fastify.post("/api/auth/login", async (request) => {
    const body = request.body as {
      email: string;
      password: string;
      totpCode?: string;
      clientId?: string;
    };
    return fastify.authService.loginWithPassword({
      email: body.email,
      password: body.password,
      totpCode: body.totpCode,
      clientId: body.clientId ?? "desktop",
    });
  });

  fastify.post("/api/auth/refresh", async (request) => {
    const body = request.body as { refreshToken: string };
    return fastify.authService.refreshTokens(body.refreshToken);
  });

  fastify.post("/api/auth/oidc/start", async (request) => {
    const body = request.body as {
      providerId: string;
      redirectUri: string;
      clientId?: string;
    };
    return fastify.authOidcService.startOidc(
      body.providerId,
      body.redirectUri,
      body.clientId ?? "desktop",
      false,
    );
  });

  fastify.post("/api/auth/oidc/complete", async (request) => {
    const body = request.body as {
      providerId?: string;
      redirectUri: string;
      state: string;
      code: string;
      clientId?: string;
    };
    return fastify.authOidcService.completeOidc({
      providerId: body.providerId,
      redirectUri: body.redirectUri,
      state: body.state,
      code: body.code,
      clientId: body.clientId ?? "desktop",
    });
  });
}
