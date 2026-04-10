import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@slate/server-db";
import { AppConfigName } from "@slate/server-db";

export async function internalAdminJson<T>(
  fastify: FastifyInstance,
  accessToken: string,
  opts: { method: string; path: string; body?: unknown },
): Promise<T> {
  const method = opts.method.toLowerCase() as "get" | "post" | "patch" | "delete" | "put";
  const res = await fastify.inject({
    method,
    url: opts.path,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    payload: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const raw = res.payload.length > 0 ? res.payload : res.body;
  let payload: unknown = {};
  if (raw.length > 0) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      payload = { message: raw };
    }
  }
  if (res.statusCode >= 400) {
    const msg =
      typeof (payload as { message?: string }).message === "string"
        ? (payload as { message: string }).message
        : `Request failed (${res.statusCode})`;
    throw new Error(msg);
  }
  return payload as T;
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

function adminResourceId(resource: { id: () => string; _decorated?: { id?: () => string } }) {
  return resource._decorated?.id?.() ?? resource.id();
}

async function findRecordOrThrow(
  context: {
    resource: {
      findOne: (
        id: string,
        ctx: unknown,
      ) => Promise<{ toJSON: (admin?: unknown) => unknown } | null>;
    };
    currentAdmin?: unknown;
  },
  id: string,
) {
  const record = await context.resource.findOne(id, context);
  if (!record) {
    throw new Error("Record not found");
  }
  return record;
}

function requireCurrentAdminAccessToken(currentAdmin: Record<string, unknown> | null | undefined) {
  const token = typeof currentAdmin?.accessToken === "string" ? currentAdmin.accessToken : "";
  if (!token) {
    throw new Error("Admin session is missing access token");
  }
  return token;
}

async function fetchEmbeddingDashboardStats(prisma: PrismaClient) {
  type EmbeddingConfigUser = { userId: string };
  const configs = await prisma.aiConfig.findMany({
    where: {
      embeddingModel: { not: null },
      embeddingProvider: { not: null },
    },
    select: { userId: true },
  });
  const userIds = configs.map((c: EmbeddingConfigUser) => c.userId);
  if (userIds.length === 0) {
    return {
      usersWithEmbeddingConfigured: 0,
      documentsQueuedForEmbedding: 0,
      documentsEmbeddedIndexed: 0,
    };
  }
  const [documentsQueuedForEmbedding, documentsEmbeddedIndexed] = await Promise.all([
    prisma.document.count({
      where: { userId: { in: userIds }, embedded: false, deleted: false },
    }),
    prisma.document.count({
      where: { userId: { in: userIds }, embedded: true, deleted: false },
    }),
  ]);
  return {
    usersWithEmbeddingConfigured: configs.length,
    documentsQueuedForEmbedding,
    documentsEmbeddedIndexed,
  };
}

export async function fetchDashboardStats(fastify: FastifyInstance) {
  const prisma = fastify.prisma;
  const [
    totalUsers,
    totalAdmins,
    totalDocuments,
    totalAttachments,
    accountCreationSetting,
    passwordAuthSetting,
    oidcProvidersCount,
    oidcProvidersEnabledCount,
    embeddingStats,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isAdmin: true } }),
    prisma.document.count({ where: { deleted: false } }),
    prisma.attachment.count(),
    prisma.appConfig.findUnique({ where: { name: AppConfigName.ACCOUNT_CREATION_ENABLED } }),
    prisma.appConfig.findUnique({ where: { name: AppConfigName.PASSWORD_AUTH_ENABLED } }),
    prisma.oidcProviderConfig.count(),
    prisma.oidcProviderConfig.count({ where: { enabled: true } }),
    fetchEmbeddingDashboardStats(prisma),
  ]);
  return {
    totalUsers,
    totalAdmins,
    totalDocuments,
    totalAttachments,
    accountCreationEnabled: (accountCreationSetting?.value ?? "true") === "true",
    passwordAuthEnabled: (passwordAuthSetting?.value ?? "true") === "true",
    oidcProvidersCount,
    oidcProvidersEnabledCount,
    ...embeddingStats,
  };
}

const readOnlyResourceActions = {
  new: { isAccessible: false },
  edit: { isAccessible: false },
  delete: { isAccessible: false },
  bulkDelete: { isAccessible: false },
};

export function buildAdminResources(
  fastify: FastifyInstance,
  prisma: PrismaClient,
  getModelByName: (name: string) => unknown,
  plainTextComponent: string,
) {
  return [
    {
      resource: { model: getModelByName("User"), client: prisma },
      options: {
        navigation: { name: "Accounts", icon: "User" },
        listProperties: ["email", "displayName", "isAdmin", "createdAt"],
        showProperties: [
          "id",
          "email",
          "displayName",
          "normalizedUsername",
          "isAdmin",
          "createdAt",
          "updatedAt",
        ],
        editProperties: ["email", "displayName", "password", "isAdmin"],
        properties: {
          passwordHash: { isVisible: false },
          password: {
            type: "password",
            isVisible: { list: false, show: false, edit: true, filter: false },
            description:
              "Minimum 8 characters. Leave blank when editing to keep the current password.",
          },
        },
        actions: {
          ...readOnlyResourceActions,
          new: {
            isAccessible: true,
            handler: async (request: any, _response: any, context: any) => {
              const { resource, currentAdmin, h } = context;
              if (request.method === "get") {
                return { record: resource.build({}).toJSON(currentAdmin) };
              }

              const accessToken = requireCurrentAdminAccessToken(
                currentAdmin as Record<string, unknown>,
              );
              const payload = request.payload ?? {};
              const created = await internalAdminJson<{ id: string }>(fastify, accessToken, {
                method: "POST",
                path: "/internal/admin/users",
                body: {
                  email: String(payload.email ?? ""),
                  displayName: String(payload.displayName ?? ""),
                  password: String(payload.password ?? ""),
                  isAdmin: asBoolean(payload.isAdmin, false),
                },
              });

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

              const accessToken = requireCurrentAdminAccessToken(
                currentAdmin as Record<string, unknown>,
              );
              const payload = request.payload ?? {};
              const passwordValue =
                typeof payload.password === "string" && payload.password.length > 0
                  ? payload.password
                  : undefined;
              await internalAdminJson(fastify, accessToken, {
                method: "PATCH",
                path: `/internal/admin/users/${encodeURIComponent(record.id())}`,
                body: {
                  email: String(payload.email ?? record.param("email") ?? ""),
                  displayName: String(payload.displayName ?? record.param("displayName") ?? ""),
                  password: passwordValue,
                  isAdmin: asBoolean(payload.isAdmin, asBoolean(record.param("isAdmin"), false)),
                },
              });

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
      resource: { model: getModelByName("AuthIdentity"), client: prisma },
      options: {
        id: "AuthIdentity",
        navigation: { name: "Accounts", icon: "Key" },
        sort: { sortBy: "createdAt", direction: "desc" },
        listProperties: [
          "userId",
          "type",
          "provider",
          "providerSubject",
          "loginCount",
          "lastLoginAt",
          "createdAt",
        ],
        showProperties: [
          "id",
          "userId",
          "type",
          "provider",
          "providerSubject",
          "loginCount",
          "lastUsedAt",
          "lastLoginAt",
          "createdAt",
        ],
        properties: {
          type: {
            availableValues: [
              { value: "PASSWORD", label: "Password" },
              { value: "OIDC", label: "OIDC" },
            ],
          },
        },
        actions: readOnlyResourceActions,
      },
    },
    {
      resource: { model: getModelByName("Document"), client: prisma },
      options: {
        navigation: { name: "Content", icon: "Document" },
        sort: { sortBy: "updatedAt", direction: "desc" },
        listProperties: [
          "title",
          "path",
          "userId",
          "embedded",
          "serverSeq",
          "deleted",
          "updatedAt",
        ],
        showProperties: [
          "id",
          "userId",
          "title",
          "path",
          "markdown",
          "plainText",
          "serverSeq",
          "deleted",
          "embedded",
          "deleted",
          "updatedAt",
          "createdAt",
        ],
        properties: {
          markdown: { components: { show: plainTextComponent } },
          plainText: { components: { show: plainTextComponent } },
        },
        actions: readOnlyResourceActions,
      },
    },
    {
      resource: { model: getModelByName("Attachment"), client: prisma },
      options: {
        navigation: { name: "Content", icon: "Paperclip" },
        sort: { sortBy: "createdAt", direction: "desc" },
        listProperties: ["originalName", "mimeType", "status", "userId", "documentId", "createdAt"],
        showProperties: [
          "id",
          "userId",
          "documentId",
          "originalName",
          "mimeType",
          "sizeBytes",
          "storageKey",
          "processedKey",
          "status",
          "createdAt",
        ],
        actions: {
          ...readOnlyResourceActions,
          runGarbageCollection: {
            actionType: "resource" as const,
            icon: "Trash2",
            isAccessible: true,
            isVisible: true,
            component: false,
            guard:
              "This will mark unreferenced attachments as orphaned and delete previously orphaned files. Continue?",
            handler: async (_request: any, _response: any, context: any) => {
              const { resource, currentAdmin, h } = context;
              const accessToken = requireCurrentAdminAccessToken(
                currentAdmin as Record<string, unknown>,
              );
              await internalAdminJson(fastify, accessToken, {
                method: "POST",
                path: "/internal/admin/storage/gc",
                body: { orphanAfterMs: 0, deleteAfterMs: 0 },
              });
              const total = await prisma.attachment.count();
              const orphaned = await prisma.attachment.count({ where: { status: "orphaned" } });
              return {
                notice: {
                  message: `Garbage collection complete. ${total} attachments total, ${orphaned} orphaned.`,
                  type: "success" as const,
                },
                redirectUrl: h.resourceUrl({ resourceId: adminResourceId(resource) }),
              };
            },
          },
        },
      },
    },
    {
      resource: { model: getModelByName("Conversation"), client: prisma },
      options: {
        id: "Conversation",
        navigation: { name: "Conversations", icon: "MessageCircle" },
        sort: { sortBy: "updatedAt", direction: "desc" },
        listProperties: ["title", "userId", "createdAt", "updatedAt"],
        showProperties: ["id", "userId", "title", "summary", "createdAt", "updatedAt"],
        properties: {
          summary: { type: "textarea" },
        },
        actions: readOnlyResourceActions,
      },
    },
    {
      resource: { model: getModelByName("Message"), client: prisma },
      options: {
        id: "Message",
        navigation: { name: "Messages", icon: "MessageSquare" },
        sort: { sortBy: "createdAt", direction: "desc" },
        listProperties: ["conversationId", "role", "content", "createdAt"],
        showProperties: ["id", "conversationId", "role", "content", "metadata", "createdAt"],
        properties: {
          content: { type: "textarea" },
          role: { type: "string" },
        },
        actions: readOnlyResourceActions,
      },
    },
    {
      resource: { model: getModelByName("AppConfig"), client: prisma },
      options: {
        navigation: { name: "Configuration", icon: "Settings" },
        listProperties: ["name", "value", "updatedAt"],
        showProperties: ["name", "value", "createdAt", "updatedAt"],
        properties: {
          name: {
            type: "string",
            components: {
              list: plainTextComponent,
              show: plainTextComponent,
            },
          },
        },
        actions: {
          ...readOnlyResourceActions,
          edit: {
            isAccessible: ({ record }: any) => {
              const name = String(record?.params?.name ?? "");
              return [
                "ACCOUNT_CREATION_ENABLED",
                "PASSWORD_AUTH_ENABLED",
                "STORAGE_BACKEND",
                "STORAGE_FILESYSTEM_ROOT",
                "STORAGE_S3_ENDPOINT",
                "STORAGE_S3_BUCKET",
                "STORAGE_S3_ACCESS_KEY_ID",
                "STORAGE_S3_SECRET_ACCESS_KEY",
                "GOOGLE_CALENDAR_CLIENT_ID",
                "GOOGLE_CALENDAR_CLIENT_SECRET",
              ].includes(name);
            },
            handler: async (request: any, _response: any, context: any) => {
              const { record, resource, currentAdmin, h } = context;
              if (!record) {
                throw new Error("Record not found");
              }

              if (request.method === "get") {
                return { record: record.toJSON(currentAdmin) };
              }

              const accessToken = requireCurrentAdminAccessToken(
                currentAdmin as Record<string, unknown>,
              );
              const name = String(record.param("name") ?? "");
              const enabled = asBoolean(
                request.payload?.value,
                asBoolean(record.param("value"), true),
              );

              if (name === "ACCOUNT_CREATION_ENABLED") {
                await internalAdminJson(fastify, accessToken, {
                  method: "PATCH",
                  path: "/internal/admin/settings/account-creation-enabled",
                  body: { enabled },
                });
              } else if (name === "PASSWORD_AUTH_ENABLED") {
                await internalAdminJson(fastify, accessToken, {
                  method: "PATCH",
                  path: "/internal/admin/settings/password-auth-enabled",
                  body: { enabled },
                });
              } else if (
                [
                  "STORAGE_BACKEND",
                  "STORAGE_FILESYSTEM_ROOT",
                  "STORAGE_S3_ENDPOINT",
                  "STORAGE_S3_BUCKET",
                  "STORAGE_S3_ACCESS_KEY_ID",
                  "STORAGE_S3_SECRET_ACCESS_KEY",
                ].includes(name)
              ) {
                const patchPayload: Record<string, unknown> = {};
                const rawValue = String(request.payload?.value ?? "");
                if (name === "STORAGE_BACKEND") patchPayload.backend = rawValue;
                else if (name === "STORAGE_FILESYSTEM_ROOT") patchPayload.filesystemRoot = rawValue;
                else if (name === "STORAGE_S3_ENDPOINT") patchPayload.s3Endpoint = rawValue;
                else if (name === "STORAGE_S3_BUCKET") patchPayload.s3Bucket = rawValue;
                else if (name === "STORAGE_S3_ACCESS_KEY_ID") patchPayload.s3AccessKeyId = rawValue;
                else if (name === "STORAGE_S3_SECRET_ACCESS_KEY")
                  patchPayload.s3SecretAccessKey = rawValue;
                await internalAdminJson(fastify, accessToken, {
                  method: "PATCH",
                  path: "/internal/admin/storage/config",
                  body: patchPayload,
                });
              } else if (
                ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"].includes(name)
              ) {
                const patchPayload: Record<string, unknown> = {};
                const rawValue = String(request.payload?.value ?? "");
                if (name === "GOOGLE_CALENDAR_CLIENT_ID") patchPayload.clientId = rawValue;
                else if (name === "GOOGLE_CALENDAR_CLIENT_SECRET")
                  patchPayload.clientSecret = rawValue;
                await internalAdminJson(fastify, accessToken, {
                  method: "PATCH",
                  path: "/internal/admin/calendar/config",
                  body: patchPayload,
                });
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
        showProperties: [
          "providerId",
          "label",
          "issuerUrl",
          "clientId",
          "scopes",
          "enabled",
          "createdAt",
          "updatedAt",
        ],
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
                  request?.headers?.["x-forwarded-host"] ??
                    request?.headers?.host ??
                    `localhost:${process.env.PORT ?? "4000"}`,
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

              const accessToken = requireCurrentAdminAccessToken(
                currentAdmin as Record<string, unknown>,
              );
              const payload = request.payload ?? {};
              const providerId = String(payload.providerId ?? "").trim();
              if (!providerId) {
                throw new Error("providerId is required");
              }

              const created = await internalAdminJson<{ providerId: string }>(
                fastify,
                accessToken,
                {
                  method: "POST",
                  path: "/internal/admin/oidc/providers",
                  body: {
                    providerId,
                    label: String(payload.label ?? ""),
                    issuerUrl: String(payload.issuerUrl ?? ""),
                    clientId: String(payload.clientId ?? ""),
                    clientSecret: String(payload.clientSecretEncrypted ?? ""),
                    scopes: String(payload.scopes ?? "openid profile email"),
                    enabled: asBoolean(payload.enabled, true),
                  },
                },
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
                  request?.headers?.["x-forwarded-host"] ??
                    request?.headers?.host ??
                    `localhost:${process.env.PORT ?? "4000"}`,
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

              const accessToken = requireCurrentAdminAccessToken(
                currentAdmin as Record<string, unknown>,
              );
              const payload = request.payload ?? {};
              await internalAdminJson(fastify, accessToken, {
                method: "PATCH",
                path: `/internal/admin/oidc/providers/${encodeURIComponent(String(record.param("providerId") ?? record.id()))}`,
                body: {
                  label: String(payload.label ?? record.param("label") ?? ""),
                  issuerUrl: String(payload.issuerUrl ?? record.param("issuerUrl") ?? ""),
                  clientId: String(payload.clientId ?? record.param("clientId") ?? ""),
                  clientSecret:
                    typeof payload.clientSecretEncrypted === "string" &&
                    payload.clientSecretEncrypted.trim().length > 0
                      ? payload.clientSecretEncrypted.trim()
                      : undefined,
                  scopes: String(
                    payload.scopes ?? record.param("scopes") ?? "openid profile email",
                  ),
                  enabled: asBoolean(payload.enabled, asBoolean(record.param("enabled"), true)),
                },
              });

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

              const accessToken = requireCurrentAdminAccessToken(
                currentAdmin as Record<string, unknown>,
              );
              await internalAdminJson(fastify, accessToken, {
                method: "DELETE",
                path: `/internal/admin/oidc/providers/${encodeURIComponent(String(record.param("providerId") ?? record.id()))}`,
              });

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
    {
      resource: { model: getModelByName("CalendarConnection"), client: prisma },
      options: {
        id: "CalendarConnection",
        navigation: { name: "Calendar", icon: "Calendar" },
        sort: { sortBy: "createdAt", direction: "desc" },
        listProperties: ["userId", "provider", "accountIdentifier", "tokenExpiresAt", "createdAt"],
        showProperties: [
          "id",
          "userId",
          "provider",
          "accountIdentifier",
          "scopes",
          "tokenExpiresAt",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          accessTokenEncrypted: { isVisible: false },
          refreshTokenEncrypted: { isVisible: false },
        },
        actions: readOnlyResourceActions,
      },
    },
    {
      resource: { model: getModelByName("CalendarSubscription"), client: prisma },
      options: {
        id: "CalendarSubscription",
        navigation: { name: "Calendar", icon: "Calendar" },
        sort: { sortBy: "createdAt", direction: "desc" },
        listProperties: ["userId", "name", "externalCalendarId", "enabled", "color", "createdAt"],
        showProperties: [
          "id",
          "userId",
          "connectionId",
          "externalCalendarId",
          "name",
          "color",
          "enabled",
          "createdAt",
          "updatedAt",
        ],
        actions: readOnlyResourceActions,
      },
    },
    {
      resource: { model: getModelByName("IcsSubscription"), client: prisma },
      options: {
        id: "IcsSubscription",
        navigation: { name: "Calendar", icon: "Calendar" },
        sort: { sortBy: "createdAt", direction: "desc" },
        listProperties: ["userId", "name", "url", "enabled", "color", "createdAt"],
        showProperties: [
          "id",
          "userId",
          "url",
          "name",
          "color",
          "enabled",
          "createdAt",
          "updatedAt",
        ],
        actions: readOnlyResourceActions,
      },
    },
    {
      resource: { model: getModelByName("AiConfig"), client: prisma },
      options: {
        navigation: { name: "AI", icon: "Settings" },
        properties: {
          embeddingApiKey: {
            isVisible: { list: false, show: true, edit: true, filter: false },
          },
          chatApiKey: {
            isVisible: { list: false, show: true, edit: true, filter: false },
          },
        },
      },
    },
  ];
}
