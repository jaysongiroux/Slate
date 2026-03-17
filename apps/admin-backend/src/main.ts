import "dotenv/config";
import AdminJS from "adminjs";
import AdminJSExpress from "@adminjs/express";
import { Database, Resource, getModelByName } from "@adminjs/prisma";
import { AppConfigName, PrismaClient } from "@slate/server-db";
import express, { NextFunction, Request, Response } from "express";
import session from "express-session";

AdminJS.registerAdapter({ Database, Resource });

const adminPort = Number(process.env.ADMIN_PORT ?? 4100);
const coreBackendUrl = process.env.CORE_BACKEND_URL ?? "http://localhost:4000";
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET ?? "local-admin-session-secret";
const prisma = new PrismaClient();

type CoreAdminLoginResponse = {
  accessToken: string;
  expiresAtUnix: number;
  user: {
    id: string;
    email: string;
    displayName: string;
    isAdmin: boolean;
  };
};

type CorePublicOidcProvider = {
  providerId: string;
  label: string;
};

type CoreLoginOptionsResponse = {
  providers: CorePublicOidcProvider[];
  passwordAuthEnabled: boolean;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

async function coreRequest<T>(path: string, init?: RequestInit, accessToken?: string) {
  const headers = new Headers(init?.headers);
  if (accessToken) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${coreBackendUrl}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  const payload = text.length > 0 ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = typeof payload.message === "string" ? payload.message : `Core request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
}

function requireCurrentAdminAccessToken(currentAdmin: Record<string, unknown> | null | undefined) {
  const token = typeof currentAdmin?.accessToken === "string" ? currentAdmin.accessToken : "";
  if (!token) {
    throw new Error("Admin session is missing access token");
  }
  return token;
}

function adminResourceId(resource: { id: () => string; _decorated?: { id?: () => string } }) {
  return resource._decorated?.id?.() ?? resource.id();
}

async function findRecordOrThrow(context: {
  resource: { findOne: (id: string, ctx: unknown) => Promise<{ toJSON: (admin?: unknown) => unknown } | null> };
  currentAdmin?: unknown;
}, id: string) {
  const record = await context.resource.findOne(id, context);
  if (!record) {
    throw new Error("Record not found");
  }
  return record;
}

async function fetchLoginOptions() {
  return coreRequest<CoreLoginOptionsResponse>("/internal/admin/auth/oidc/providers");
}

async function fetchDashboardStats() {
  const [
    totalUsers,
    totalAdmins,
    totalWorkspaces,
    totalDocuments,
    totalAttachments,
    accountCreationSetting,
    passwordAuthSetting,
    oidcProvidersCount,
    oidcProvidersEnabledCount,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isAdmin: true } }),
    prisma.workspace.count(),
    prisma.document.count({ where: { deleted: false } }),
    prisma.attachment.count(),
    prisma.appConfig.findUnique({ where: { name: AppConfigName.ACCOUNT_CREATION_ENABLED } }),
    prisma.appConfig.findUnique({ where: { name: AppConfigName.PASSWORD_AUTH_ENABLED } }),
    prisma.oidcProviderConfig.count(),
    prisma.oidcProviderConfig.count({ where: { enabled: true } }),
  ]);

  return {
    totalUsers,
    totalAdmins,
    totalWorkspaces,
    totalDocuments,
    totalAttachments,
    accountCreationEnabled: (accountCreationSetting?.value ?? "true") === "true",
    passwordAuthEnabled: (passwordAuthSetting?.value ?? "true") === "true",
    oidcProvidersCount,
    oidcProvidersEnabledCount,
  };
}

async function requiresInitialSetup() {
  const status = await coreRequest<{ requiresInitialSetup: boolean }>("/internal/admin/bootstrap-status");
  return status.requiresInitialSetup;
}

function requireAdminSession(request: Request, response: Response, next: NextFunction) {
  if (!request.session.adminSession?.accessToken) {
    response.redirect("/admin/login");
    return;
  }

  if (!request.session.adminUser) {
    request.session.adminUser = {
      id: request.session.adminSession.user.id,
      email: request.session.adminSession.user.email,
      title: request.session.adminSession.user.displayName,
      accessToken: request.session.adminSession.accessToken,
    };
  }

  next();
}

type LoginPageOptions = {
  errorMessage?: string;
  created?: boolean;
  passwordAuthEnabled: boolean;
  oidcProviders: CorePublicOidcProvider[];
};

function loginPage(options: LoginPageOptions) {
  const errorHtml = options.errorMessage
    ? `<div class="banner error">${escapeHtml(options.errorMessage)}</div>`
    : "";
  const createdHtml = options.created ? `<div class="banner ok">Initial admin account created. Sign in below.</div>` : "";

  const oidcHtml =
    options.oidcProviders.length > 0
      ? `<div class="oidc-wrap"><div class="muted">Single sign-on</div>${options.oidcProviders
          .map(
            (provider) =>
              `<a class="oidc-button" href="/admin/login/oidc/${encodeURIComponent(provider.providerId)}">Continue with ${escapeHtml(provider.label)}</a>`,
          )
          .join("")}</div>`
      : "";

  const passwordFormHtml = options.passwordAuthEnabled
    ? `<form method="post" action="/admin/login">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" required />
      <button type="submit">Sign in with password</button>
    </form>`
    : `<div class="muted" style="margin-top: 12px;">Password authentication is disabled.</div>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Slate Admin Login</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0f13;color:#f5f7fb;font:16px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif}
      .card{width:min(460px,calc(100vw - 32px));padding:28px;border-radius:18px;background:rgba(19,22,29,.95);border:1px solid rgba(255,255,255,.08)}
      h1{margin:0 0 8px;font-size:28px;letter-spacing:-0.03em}
      p{margin:0 0 16px;color:rgba(245,247,251,.7)}
      label{display:block;margin:14px 0 6px;font-size:14px;color:rgba(245,247,251,.85)}
      input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#121722;color:#fff;box-sizing:border-box}
      button{margin-top:16px;width:100%;padding:12px;border:none;border-radius:10px;background:#f5f7fb;color:#111;font-weight:600;cursor:pointer}
      .oidc-wrap{margin:14px 0 8px}
      .oidc-button{display:block;margin-top:8px;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.16);text-decoration:none;color:#fff;background:#151a23}
      .muted{font-size:13px;color:rgba(245,247,251,.63)}
      .banner{margin-bottom:12px;padding:10px 12px;border-radius:10px;font-size:14px}
      .banner.error{background:#3f1b1f;color:#ffbac2;border:1px solid rgba(255,186,194,.22)}
      .banner.ok{background:#153224;color:#b8ffda;border:1px solid rgba(184,255,218,.22)}
      .links{margin-top:12px;font-size:14px}
      .divider{height:1px;background:rgba(255,255,255,.08);margin:16px 0}
      a{color:#b8d4ff}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Slate Admin</h1>
      <p>Sign in with an admin account managed by the core backend.</p>
      ${createdHtml}
      ${errorHtml}
      ${oidcHtml}
      ${options.oidcProviders.length > 0 && options.passwordAuthEnabled ? '<div class="divider"></div>' : ""}
      ${passwordFormHtml}
      <div class="links"><a href="/admin/setup">Initial setup</a></div>
    </div>
  </body>
</html>`;
}

function setupPage(errorMessage = "") {
  const errorHtml = errorMessage ? `<div class="banner error">${escapeHtml(errorMessage)}</div>` : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Slate Initial Admin Setup</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0f13;color:#f5f7fb;font:16px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif}
      .card{width:min(460px,calc(100vw - 32px));padding:28px;border-radius:18px;background:rgba(19,22,29,.95);border:1px solid rgba(255,255,255,.08)}
      h1{margin:0 0 8px;font-size:28px;letter-spacing:-0.03em}
      p{margin:0 0 16px;color:rgba(245,247,251,.7)}
      label{display:block;margin:14px 0 6px;font-size:14px;color:rgba(245,247,251,.85)}
      input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#121722;color:#fff;box-sizing:border-box}
      button{margin-top:16px;width:100%;padding:12px;border:none;border-radius:10px;background:#f5f7fb;color:#111;font-weight:600;cursor:pointer}
      .banner.error{margin-bottom:12px;padding:10px 12px;border-radius:10px;background:#3f1b1f;color:#ffbac2;border:1px solid rgba(255,186,194,.22)}
    </style>
  </head>
  <body>
    <form class="card" method="post" action="/admin/setup">
      <h1>Initial setup</h1>
      <p>Create the first administrator account. This page is disabled after the first user exists.</p>
      ${errorHtml}
      <label for="displayName">Display name</label>
      <input id="displayName" name="displayName" type="text" required />
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" minlength="8" required />
      <button type="submit">Create initial admin</button>
    </form>
  </body>
</html>`;
}

async function bootstrap() {
  const app = express();
  app.set("trust proxy", 1);
  app.set("json replacer", (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value));

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(
    session({
      secret: adminSessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );

  app.get("/admin/login", (request, response) => {
    void (async () => {
      if (await requiresInitialSetup()) {
        response.redirect("/admin/setup");
        return;
      }

      const options = await fetchLoginOptions();
      response.type("html").send(
        loginPage({
          errorMessage: "",
          created: request.query.created === "1",
          passwordAuthEnabled: options.passwordAuthEnabled,
          oidcProviders: options.providers,
        }),
      );
    })().catch((error) => {
      const message = error instanceof Error ? error.message : "Core backend is unavailable";
      response.type("html").send(
        loginPage({
          errorMessage: message,
          created: false,
          passwordAuthEnabled: true,
          oidcProviders: [],
        }),
      );
    });
  });

  app.post("/admin/login", async (request, response) => {
    try {
      const loginResponse = await coreRequest<CoreAdminLoginResponse>("/internal/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: String(request.body.email ?? ""),
          password: String(request.body.password ?? ""),
        }),
      });

      request.session.adminSession = loginResponse;
      request.session.adminUser = {
        id: loginResponse.user.id,
        email: loginResponse.user.email,
        title: loginResponse.user.displayName,
        accessToken: loginResponse.accessToken,
      };
      response.redirect("/admin/portal");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sign in";
      const options = await fetchLoginOptions().catch(() => ({ providers: [], passwordAuthEnabled: true }));
      response.status(401).type("html").send(
        loginPage({
          errorMessage: message,
          created: false,
          passwordAuthEnabled: options.passwordAuthEnabled,
          oidcProviders: options.providers,
        }),
      );
    }
  });

  app.get("/admin/login/oidc/:providerId", async (request, response) => {
    try {
      if (await requiresInitialSetup()) {
        response.redirect("/admin/setup");
        return;
      }

      const providerId = String(request.params.providerId ?? "").trim();
      if (!providerId) {
        response.redirect("/admin/login?error=Missing%20provider");
        return;
      }

      const redirectUri = new URL(
        "/admin/login/oidc/callback",
        `${request.protocol}://${request.get("host") ?? `localhost:${adminPort}`}`,
      ).toString();

      const started = await coreRequest<{ authorizationUrl: string }>(
        "/internal/admin/auth/oidc/start",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            providerId,
            redirectUri,
          }),
        },
      );

      response.redirect(started.authorizationUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start OIDC login";
      const options = await fetchLoginOptions().catch(() => ({ providers: [], passwordAuthEnabled: true }));
      response.status(401).type("html").send(
        loginPage({
          errorMessage: message,
          created: false,
          passwordAuthEnabled: options.passwordAuthEnabled,
          oidcProviders: options.providers,
        }),
      );
    }
  });

  app.get("/admin/login/oidc/callback", async (request, response) => {
    try {
      const code = String(request.query.code ?? "").trim();
      const state = String(request.query.state ?? "").trim();
      if (!code || !state) {
        throw new Error("OIDC callback is missing code/state");
      }

      const redirectUri = new URL(
        "/admin/login/oidc/callback",
        `${request.protocol}://${request.get("host") ?? `localhost:${adminPort}`}`,
      ).toString();

      const loginResponse = await coreRequest<CoreAdminLoginResponse>("/internal/admin/auth/oidc/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state,
          code,
          redirectUri,
        }),
      });

      request.session.adminSession = loginResponse;
      request.session.adminUser = {
        id: loginResponse.user.id,
        email: loginResponse.user.email,
        title: loginResponse.user.displayName,
        accessToken: loginResponse.accessToken,
      };
      response.redirect("/admin/portal");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to complete OIDC login";
      const options = await fetchLoginOptions().catch(() => ({ providers: [], passwordAuthEnabled: true }));
      response.status(401).type("html").send(
        loginPage({
          errorMessage: message,
          created: false,
          passwordAuthEnabled: options.passwordAuthEnabled,
          oidcProviders: options.providers,
        }),
      );
    }
  });

  const performLogout = (request: Request, response: Response) => {
    // Clear AdminJS auth shape and internal admin session, then drop the session cookie.
    request.session.adminUser = undefined;
    request.session.adminSession = undefined;
    request.session.destroy(() => {
      response.clearCookie("connect.sid");
      response.redirect("/admin/login");
    });
  };

  app.get("/admin/logout", (request, response) => {
    performLogout(request, response);
  });

  app.post("/admin/logout", (request, response) => {
    performLogout(request, response);
  });

  app.get("/admin/setup", async (_request, response) => {
    try {
      const status = await coreRequest<{ requiresInitialSetup: boolean }>("/internal/admin/bootstrap-status");
      if (!status.requiresInitialSetup) {
        response.redirect("/admin/login");
        return;
      }

      response.type("html").send(setupPage());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to check setup status";
      response.status(500).type("html").send(setupPage(message));
    }
  });

  app.post("/admin/setup", async (request, response) => {
    try {
      await coreRequest("/internal/admin/setup-initial", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: String(request.body.displayName ?? ""),
          email: String(request.body.email ?? ""),
          password: String(request.body.password ?? ""),
        }),
      });
      response.redirect("/admin/login?created=1");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create initial admin";
      response.status(400).type("html").send(setupPage(message));
    }
  });

  const readOnlyResourceActions = {
    new: { isAccessible: false },
    edit: { isAccessible: false },
    delete: { isAccessible: false },
    bulkDelete: { isAccessible: false },
  };

  const admin = new AdminJS({
    rootPath: "/admin/portal",
    branding: {
      companyName: "Slate Admin",
    },
    dashboard: {
      handler: async () => fetchDashboardStats(),
    },
    resources: [
      {
        resource: { model: getModelByName("User"), client: prisma },
        options: {
          navigation: { name: "Accounts", icon: "User" },
          listProperties: ["email", "displayName", "isAdmin", "createdAt"],
          showProperties: ["id", "email", "displayName", "normalizedUsername", "isAdmin", "createdAt", "updatedAt"],
          actions: {
            ...readOnlyResourceActions,
            new: {
              isAccessible: true,
              handler: async (request: any, _response: any, context: any) => {
                const { resource, currentAdmin, h } = context;
                if (request.method === "get") {
                  return { record: resource.build({}).toJSON(currentAdmin) };
                }

                const accessToken = requireCurrentAdminAccessToken(currentAdmin as Record<string, unknown>);
                const payload = request.payload ?? {};
                const created = await coreRequest<{ id: string }>(
                  "/internal/admin/users",
                  {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      email: String(payload.email ?? ""),
                      displayName: String(payload.displayName ?? ""),
                      password: String(payload.password ?? ""),
                      isAdmin: asBoolean(payload.isAdmin, false),
                    }),
                  },
                  accessToken,
                );

                const record = await findRecordOrThrow(context as never, created.id);
                return {
                  redirectUrl: h.resourceUrl({ resourceId: adminResourceId(resource) }),
                  notice: { message: "successfullyCreated", type: "success" },
                  record: record.toJSON(currentAdmin),
                };
              },
            },
            edit: {
              isAccessible: true,
              handler: async (request: any, _response: any, context: any) => {
                const { record, resource, currentAdmin, h } = context;
                if (!record) {
                  throw new Error("Record not found");
                }

                if (request.method === "get") {
                  return { record: record.toJSON(currentAdmin) };
                }

                const accessToken = requireCurrentAdminAccessToken(currentAdmin as Record<string, unknown>);
                const payload = request.payload ?? {};
                await coreRequest(
                  `/internal/admin/users/${encodeURIComponent(record.id())}`,
                  {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      email: String(payload.email ?? record.param("email") ?? ""),
                      displayName: String(payload.displayName ?? record.param("displayName") ?? ""),
                      password: typeof payload.password === "string" ? payload.password : undefined,
                      isAdmin: asBoolean(payload.isAdmin, asBoolean(record.param("isAdmin"), false)),
                    }),
                  },
                  accessToken,
                );

                const refreshed = await findRecordOrThrow(context as never, record.id());
                return {
                  redirectUrl: h.resourceUrl({ resourceId: adminResourceId(resource) }),
                  notice: { message: "successfullyUpdated", type: "success" },
                  record: refreshed.toJSON(currentAdmin),
                };
              },
            },
          },
        },
      },
      {
        resource: { model: getModelByName("Workspace"), client: prisma },
        options: {
          navigation: { name: "Accounts", icon: "Folder" },
          actions: readOnlyResourceActions,
        },
      },
      {
        resource: { model: getModelByName("Document"), client: prisma },
        options: {
          navigation: { name: "Content", icon: "Document" },
          sort: { sortBy: "updatedAt", direction: "desc" },
          listProperties: ["title", "path", "workspaceId", "ownerUserId", "acceptedRevision", "updatedAt"],
          showProperties: ["id", "workspaceId", "ownerUserId", "title", "path", "markdown", "plainText", "acceptedRevision", "updatedAt", "createdAt"],
          actions: readOnlyResourceActions,
        },
      },
      {
        resource: { model: getModelByName("AppConfig"), client: prisma },
        options: {
          navigation: { name: "Configuration", icon: "Settings" },
          listProperties: ["name", "value", "updatedAt"],
          showProperties: ["name", "value", "createdAt", "updatedAt"],
          actions: {
            ...readOnlyResourceActions,
            edit: {
              isAccessible: ({ record }: any) => {
                const name = String(record?.params?.name ?? "");
                return name === "ACCOUNT_CREATION_ENABLED" || name === "PASSWORD_AUTH_ENABLED";
              },
              handler: async (request: any, _response: any, context: any) => {
                const { record, resource, currentAdmin, h } = context;
                if (!record) {
                  throw new Error("Record not found");
                }

                if (request.method === "get") {
                  return { record: record.toJSON(currentAdmin) };
                }

                const accessToken = requireCurrentAdminAccessToken(currentAdmin as Record<string, unknown>);
                const name = String(record.param("name") ?? "");
                const enabled = asBoolean(request.payload?.value, asBoolean(record.param("value"), true));

                if (name === "ACCOUNT_CREATION_ENABLED") {
                  await coreRequest(
                    "/internal/admin/settings/account-creation-enabled",
                    {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ enabled }),
                    },
                    accessToken,
                  );
                } else if (name === "PASSWORD_AUTH_ENABLED") {
                  await coreRequest(
                    "/internal/admin/settings/password-auth-enabled",
                    {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ enabled }),
                    },
                    accessToken,
                  );
                } else {
                  throw new Error("Setting is read-only");
                }

                const refreshed = await findRecordOrThrow(context as never, record.id());
                return {
                  redirectUrl: h.resourceUrl({ resourceId: adminResourceId(resource) }),
                  notice: { message: "successfullyUpdated", type: "success" },
                  record: refreshed.toJSON(currentAdmin),
                };
              },
            },
          },
        },
      },
      {
        resource: { model: getModelByName("OidcProviderConfig"), client: prisma },
        options: {
          navigation: { name: "Configuration", icon: "Settings" },
          listProperties: ["providerId", "label", "issuerUrl", "enabled", "updatedAt"],
          showProperties: ["providerId", "label", "issuerUrl", "clientId", "scopes", "enabled", "createdAt", "updatedAt"],
          editProperties: [
            "providerId",
            "label",
            "issuerUrl",
            "clientId",
            "clientSecretEncrypted",
            "scopes",
            "enabled",
          ],
          properties: {
            providerId: {
              props: {
                placeholder: "Slug, e.g. google | github | zitadel",
              },
            },
            issuerUrl: {
              props: {
                placeholder: "Issuer URL, e.g. https://accounts.google.com",
              },
            },
            clientId: {
              props: {
                placeholder:
                  "Client ID. Register redirects: https://<admin-host>/admin/login/oidc/callback and http://127.0.0.1:<port>/oidc/callback",
              },
            },
            scopes: {
              props: {
                placeholder: "Must include: openid profile email",
              },
            },
            clientSecretEncrypted: {
              isVisible: { list: false, filter: false, show: false, edit: true, new: true },
              props: {
                type: "password",
                placeholder: "Client secret (stored encrypted by core backend)",
              },
            },
          },
          actions: {
            ...readOnlyResourceActions,
            new: {
              isAccessible: true,
              handler: async (request: any, _response: any, context: any) => {
                const { resource, currentAdmin, h } = context;
                if (request.method === "get") {
                  const hostHeader = String(
                    request?.headers?.["x-forwarded-host"] ?? request?.headers?.host ?? `localhost:${adminPort}`,
                  )
                    .split(",")[0]
                    .trim();
                  const protoHeader = String(request?.headers?.["x-forwarded-proto"] ?? "http")
                    .split(",")[0]
                    .trim();
                  const adminCallback = `${protoHeader}://${hostHeader}/admin/login/oidc/callback`;
                  return {
                    record: resource
                      .build({
                        scopes: "openid profile email",
                      })
                      .toJSON(currentAdmin),
                    notice: {
                      type: "info",
                      message:
                        `OIDC setup: add redirect URI ${adminCallback}; ` +
                        "for desktop also allow http://127.0.0.1:<port>/oidc/callback.",
                    },
                  };
                }

                const accessToken = requireCurrentAdminAccessToken(currentAdmin as Record<string, unknown>);
                const payload = request.payload ?? {};
                const providerId = String(payload.providerId ?? "").trim();
                if (!providerId) {
                  throw new Error("providerId is required");
                }

                const created = await coreRequest<{ providerId: string }>(
                  "/internal/admin/oidc/providers",
                  {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      providerId,
                      label: String(payload.label ?? ""),
                      issuerUrl: String(payload.issuerUrl ?? ""),
                      clientId: String(payload.clientId ?? ""),
                      clientSecret: String(payload.clientSecretEncrypted ?? ""),
                      scopes: String(payload.scopes ?? "openid profile email"),
                      enabled: asBoolean(payload.enabled, true),
                    }),
                  },
                  accessToken,
                );

                const createdRow = await prisma.oidcProviderConfig.findUnique({
                  where: { providerId: created.providerId },
                  select: { id: true },
                });
                if (!createdRow) {
                  throw new Error("Provider record not found after creation");
                }

                const record = await context.resource.findOne(createdRow.id, context);
                if (!record) {
                  throw new Error("Provider record not found after creation");
                }

                return {
                  redirectUrl: h.resourceUrl({ resourceId: adminResourceId(resource) }),
                  notice: { message: "successfullyCreated", type: "success" },
                  record: record.toJSON(currentAdmin),
                };
              },
            },
            edit: {
              isAccessible: true,
              handler: async (request: any, _response: any, context: any) => {
                const { record, resource, currentAdmin, h } = context;
                if (!record) {
                  throw new Error("Record not found");
                }

                if (request.method === "get") {
                  const hostHeader = String(
                    request?.headers?.["x-forwarded-host"] ?? request?.headers?.host ?? `localhost:${adminPort}`,
                  )
                    .split(",")[0]
                    .trim();
                  const protoHeader = String(request?.headers?.["x-forwarded-proto"] ?? "http")
                    .split(",")[0]
                    .trim();
                  const adminCallback = `${protoHeader}://${hostHeader}/admin/login/oidc/callback`;
                  const guide = [
                    `Admin redirect URI: ${adminCallback}`,
                    "Desktop loopback redirect URI pattern: http://127.0.0.1:<port>/oidc/callback",
                    "Required scopes: openid profile email",
                  ].join("\\n");
                  const recordJson = record.toJSON(currentAdmin);
                  return {
                    record: {
                      ...recordJson,
                      params: {
                        ...recordJson.params,
                      },
                    },
                    notice: {
                      type: "info",
                      message:
                        `OIDC setup: redirect URI ${adminCallback}; ` +
                        "desktop loopback http://127.0.0.1:<port>/oidc/callback.",
                    },
                  };
                }

                const accessToken = requireCurrentAdminAccessToken(currentAdmin as Record<string, unknown>);
                const payload = request.payload ?? {};
                await coreRequest(
                  `/internal/admin/oidc/providers/${encodeURIComponent(String(record.param("providerId") ?? record.id()))}`,
                  {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      label: String(payload.label ?? record.param("label") ?? ""),
                      issuerUrl: String(payload.issuerUrl ?? record.param("issuerUrl") ?? ""),
                      clientId: String(payload.clientId ?? record.param("clientId") ?? ""),
                      clientSecret:
                        typeof payload.clientSecretEncrypted === "string" && payload.clientSecretEncrypted.trim().length > 0
                          ? payload.clientSecretEncrypted.trim()
                          : undefined,
                      scopes: String(payload.scopes ?? record.param("scopes") ?? "openid profile email"),
                      enabled: asBoolean(payload.enabled, asBoolean(record.param("enabled"), true)),
                    }),
                  },
                  accessToken,
                );

                const refreshed = await findRecordOrThrow(context as never, record.id());
                return {
                  redirectUrl: h.resourceUrl({ resourceId: adminResourceId(resource) }),
                  notice: { message: "successfullyUpdated", type: "success" },
                  record: refreshed.toJSON(currentAdmin),
                };
              },
            },
            delete: {
              isAccessible: true,
              component: false,
              guard: "confirmDelete",
              handler: async (request: any, _response: any, context: any) => {
                const { record, resource, currentAdmin, h } = context;
                if (!record) {
                  throw new Error("Record not found");
                }

                if (request.method === "get") {
                  return { record: record.toJSON(currentAdmin) };
                }

                const accessToken = requireCurrentAdminAccessToken(currentAdmin as Record<string, unknown>);
                await coreRequest(
                  `/internal/admin/oidc/providers/${encodeURIComponent(String(record.param("providerId") ?? record.id()))}`,
                  { method: "DELETE" },
                  accessToken,
                );

                return {
                  redirectUrl: h.resourceUrl({ resourceId: adminResourceId(resource) }),
                  notice: { message: "successfullyDeleted", type: "success" },
                  record: record.toJSON(currentAdmin),
                };
              },
            },
          },
        },
      },
    ],
  });

  const adminRouter = AdminJSExpress.buildRouter(admin);
  app.use("/admin/portal", requireAdminSession, adminRouter);

  app.get("/admin", (request, response) => {
    void (async () => {
      if (await requiresInitialSetup()) {
        response.redirect("/admin/setup");
        return;
      }

      if (request.session.adminSession?.accessToken) {
        response.redirect("/admin/portal");
        return;
      }

      response.redirect("/admin/login");
    })().catch(() => {
      response.redirect("/admin/login");
    });
  });

  app.get("/", (request, response) => {
    void (async () => {
      if (await requiresInitialSetup()) {
        response.redirect("/admin/setup");
        return;
      }

      if (request.session.adminSession?.accessToken) {
        response.redirect("/admin/portal");
        return;
      }

      response.redirect("/admin/login");
    })().catch(() => {
      response.redirect("/admin/login");
    });
  });

  app.listen(adminPort, () => {
    process.stdout.write(`Admin backend listening on http://localhost:${adminPort}\n`);
  });
}

void bootstrap().catch(async (error) => {
  process.stderr.write(`Failed to start admin backend: ${String(error)}\n`);
  await prisma.$disconnect();
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
