import fp from "fastify-plugin";
import fjwt from "@fastify/jwt";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { AuthSessionService } from "../auth/auth-session.service";
import { unauthorized } from "../lib/errors";

/**
 * Extract a Bearer token from the Authorization header.
 * Returns null if the header is missing or does not match "Bearer <token>".
 */
function extractBearerToken(request: FastifyRequest): string | null {
  const raw = request.headers.authorization;
  if (typeof raw !== "string") {
    return null;
  }
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export default fp(async function authPlugin(fastify: FastifyInstance) {
  // 1. Register @fastify/jwt
  await fastify.register(fjwt, {
    secret: fastify.config.get("JWT_SECRET", "local-dev-secret"),
  });

  // 2. Create AuthSessionService with JWT verify function + Prisma
  const authSession = new AuthSessionService(
    async (token: string) => fastify.jwt.verify(token),
    fastify.prisma,
  );
  fastify.decorate("authSession", authSession);

  // ---------------------------------------------------------------------------
  // 3. Pre-handler hooks (auth guards)
  // ---------------------------------------------------------------------------

  /**
   * authenticate — replaces HttpAuthGuard
   *
   * Extracts a Bearer token from the Authorization header, validates it via
   * AuthSessionService.validateAccessToken, and sets request.user to the
   * resulting session object. Throws 401 on any failure.
   */
  fastify.decorate(
    "authenticate",
    async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
      const token = extractBearerToken(request);
      if (!token) {
        throw unauthorized("Missing authorization token");
      }

      try {
        request.user = await authSession.validateAccessToken(token);
      } catch {
        throw unauthorized("Invalid or expired token");
      }
    },
  );

  /**
   * authenticateAdmin — replaces InternalAdminGuard
   *
   * Extracts a Bearer token from the Authorization header and verifies it
   * via authAdminService.verifyInternalAdminToken. Sets request.adminUser
   * to the verified admin user. Throws 401 on any failure.
   *
   * NOTE: fastify.authAdminService is accessed lazily at request time (not
   * at plugin registration time) because the services plugin registers it
   * after the auth plugin.
   */
  fastify.decorate(
    "authenticateAdmin",
    async function authenticateAdmin(request: FastifyRequest, _reply: FastifyReply) {
      const token = extractBearerToken(request);
      if (!token) {
        throw unauthorized("Missing admin authorization token");
      }

      // Access authAdminService lazily — it is registered by the services plugin
      // which runs after this auth plugin.
      const verified = await fastify.authAdminService.verifyInternalAdminToken(token);
      request.adminUser = {
        userId: verified.id,
        email: verified.email,
        displayName: verified.displayName,
        isAdmin: verified.isAdmin,
      };
    },
  );

  /**
   * authenticateAttachment — replaces AttachmentsGuard
   *
   * Extracts a token from either the Bearer Authorization header OR the
   * `?token=` query parameter (for <img src> tags that cannot set headers).
   * Verifies the JWT directly, checks that it has a valid `sub` and is not
   * a refresh token, then looks up the user in the database.
   * Sets request.userSession = { userId }. Throws 401 on any failure.
   */
  fastify.decorate(
    "authenticateAttachment",
    async function authenticateAttachment(request: FastifyRequest, _reply: FastifyReply) {
      // Try Bearer header first, fall back to ?token= query parameter
      let token = extractBearerToken(request);

      if (!token) {
        const query = request.query as Record<string, unknown>;
        const queryToken = query?.token;
        if (typeof queryToken === "string" && queryToken.length > 0) {
          token = queryToken;
        }
      }

      if (!token) {
        throw unauthorized("Missing authorization token");
      }

      let payload: { sub?: string; kind?: string };
      try {
        payload = fastify.jwt.verify(token);
      } catch {
        throw unauthorized("Invalid or expired session");
      }

      if (!payload?.sub || payload.kind === "refresh") {
        throw unauthorized("Invalid session payload");
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true },
      });

      if (!user) {
        throw unauthorized("Session is no longer valid");
      }

      request.userSession = {
        userId: payload.sub,
      };
    },
  );
});
