import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifySession from "@fastify/session";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as mime from "mime-types";
import { shouldBypassAdminSessionGuard } from "./session-guard";
import { createAdminJsInstance } from "./create-admin-instance";

type BodyField = {
  file?: { name?: string };
  filename?: string;
  value?: unknown;
};

function normalizeBody(body: Record<string, unknown> | undefined) {
  if (!body) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => {
      const field = value as BodyField;
      if (field?.file) {
        field.file.name = field.filename;
        return [key, field.file];
      }
      if (field?.value !== undefined) {
        return [key, field.value];
      }
      return [key, value];
    }),
  );
}

export default fp(async function adminPlugin(fastify: FastifyInstance) {
  const { admin, AdminRouter } = await createAdminJsInstance(fastify);

  const cookiePassword = fastify.config.get(
    "ADMIN_SESSION_SECRET",
    "local-admin-session-secret-change-me-123456",
  );
  const rootPath = admin.options.rootPath;
  const loginPath = admin.options.loginPath.startsWith("/")
    ? admin.options.loginPath
    : `/${admin.options.loginPath}`;
  const logoutPath = admin.options.logoutPath.startsWith("/")
    ? admin.options.logoutPath
    : `/${admin.options.logoutPath}`;
  const assetPaths = AdminRouter.assets.map((asset) => asset.path);
  const buildComponentPath = AdminRouter.routes.find(
    (route) => route.action === "bundleComponents",
  )?.path;

  await fastify.register(fastifyCookie, { secret: cookiePassword });
  await fastify.register(fastifySession, {
    cookie: {
      httpOnly: true,
      maxAge: 8 * 60 * 60 * 1000,
      sameSite: "lax",
      secure: fastify.config.get("NODE_ENV", "development") === "production",
    },
    cookieName: fastify.config.get("ADMIN_SESSION_COOKIE_NAME", "slate_admin"),
    secret: cookiePassword,
  });

  await admin.initialize();

  for (const route of AdminRouter.routes) {
    const routePath = route.path.replace(/{/g, ":").replace(/}/g, "");
    const handler = async (request: any, reply: any) => {
      const controller = new route.Controller({ admin }, request.session?.get("adminUser"));
      const html = await controller[route.action](
        {
          ...request,
          method: request.method.toLowerCase(),
          params: request.params,
          payload: normalizeBody(request.body),
          query: request.query,
        },
        reply,
      );

      if (route.contentType) {
        reply.type(route.contentType);
      } else if (typeof html === "string") {
        reply.type("text/html");
      }

      if (html) {
        return reply.send(html);
      }
      return undefined;
    };

    if (route.method === "GET") {
      fastify.get(`${admin.options.rootPath}${routePath}`, handler);
    }

    if (route.method === "POST") {
      fastify.post(`${admin.options.rootPath}${routePath}`, handler);
    }
  }

  for (const asset of AdminRouter.assets) {
    fastify.get(`${admin.options.rootPath}${asset.path}`, async (_request, reply) => {
      const mimeType = mime.lookup(asset.src);
      const file = await readFile(path.resolve(asset.src));
      if (mimeType) {
        reply.type(mimeType);
      }
      return reply.send(file);
    });
  }

  const setupPath = `${rootPath}/setup`;

  fastify.addHook("preHandler", async (request, reply) => {
    if (
      shouldBypassAdminSessionGuard({
        assetPaths,
        buildComponentPath,
        loginPath,
        logoutPath,
        setupPath,
        rootPath,
        url: request.url,
      })
    ) {
      return;
    }

    if (request.session.get("adminUser")) {
      return;
    }

    const userCount = await fastify.authAdminService.userCount();
    return reply.redirect(userCount === 0 ? setupPath : loginPath);
  });

  fastify.get(loginPath, async (_request, reply) => {
    const userCount = await fastify.authAdminService.userCount();
    if (userCount === 0) {
      return reply.redirect(setupPath);
    }

    const login = await admin.renderLogin({
      action: admin.options.loginPath,
      errorMessage: null,
    });
    return reply.type("text/html").send(login);
  });

  fastify.post(loginPath, async (request, reply) => {
    const body = (request.body ?? {}) as { email?: string; password?: string };
    const user = await fastify.authAdminService.authenticateAdmin(
      String(body.email ?? ""),
      String(body.password ?? ""),
    );

    if (!user) {
      const login = await admin.renderLogin({
        action: admin.options.loginPath,
        errorMessage: "invalidCredentials",
      });
      return reply.type("text/html").send(login);
    }

    const session = fastify.authAdminService.issueInternalAdminAccessToken(user);
    request.session.set("adminUser", {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      isAdmin: session.user.isAdmin,
      accessToken: session.accessToken,
    });
    return reply.redirect(rootPath);
  });

  const logoutHandler = async (request: any, reply: any) => {
    await request.session.destroy();
    return reply.redirect(loginPath);
  };

  fastify.get(logoutPath, logoutHandler);
  fastify.post(logoutPath, logoutHandler);

  if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
    await admin.watch();
  }
});
