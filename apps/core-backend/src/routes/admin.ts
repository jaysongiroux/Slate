import type { FastifyInstance } from "fastify";
import { AppConfigName } from "@slate/server-db";

export default async function adminRoutes(fastify: FastifyInstance) {
  const adminAuth = { preHandler: [fastify.authenticateAdmin] };

  // ── Public routes (no guard) ──

  fastify.get("/internal/admin/bootstrap-status", async () => {
    const userCount = await fastify.authAdminService.userCount();
    return {
      userCount,
      requiresInitialSetup: userCount === 0,
    };
  });

  fastify.post("/internal/admin/auth/login", async (request) => {
    const payload = request.body as { email: string; password: string };
    fastify.log.info("HTTP POST internal/admin/auth/login");
    return fastify.authAdminService.createInternalAdminSession(payload);
  });

  fastify.get("/internal/admin/auth/oidc/providers", async () => {
    const providers = await fastify.authOidcService.listPublicOidcProviders();
    const passwordAuthEnabled = await fastify.settingsService.passwordAuthEnabled();
    return { providers, passwordAuthEnabled };
  });

  fastify.post("/internal/admin/auth/oidc/start", async (request) => {
    const payload = request.body as { providerId: string; redirectUri: string };
    fastify.log.info(`HTTP POST internal/admin/auth/oidc/start providerId=${payload.providerId}`);
    return fastify.authOidcService.startAdminOidc(payload.providerId, payload.redirectUri);
  });

  fastify.post("/internal/admin/auth/oidc/complete", async (request) => {
    const payload = request.body as {
      providerId?: string;
      redirectUri: string;
      state: string;
      code: string;
    };
    const stateHint = payload.state?.slice(0, 8) ?? "";
    fastify.log.info(
      `HTTP POST internal/admin/auth/oidc/complete statePrefix=${stateHint} providerId=${payload.providerId ?? ""}`,
    );
    return fastify.authOidcService.completeAdminOidc(payload);
  });

  fastify.post("/internal/admin/setup-initial", async (request) => {
    const payload = request.body as {
      email: string;
      password: string;
      displayName: string;
    };
    const email = payload.email?.trim().toLowerCase() ?? "";
    fastify.log.info(`HTTP POST internal/admin/setup-initial email=${email || "(empty)"}`);
    return fastify.authAdminService.setupInitialAdmin(payload);
  });

  // ── Protected routes (admin guard) ──

  fastify.get("/internal/admin/me", adminAuth, async (request) => {
    return request.adminUser;
  });

  fastify.get("/internal/admin/settings", adminAuth, async () => {
    const accountCreationEnabled = await fastify.settingsService.accountCreationEnabled();
    const passwordAuthEnabled = await fastify.settingsService.passwordAuthEnabled();
    const settings = await fastify.settingsService.listSettings();
    return {
      accountCreationEnabled,
      passwordAuthEnabled,
      settings,
    };
  });

  fastify.patch("/internal/admin/settings/account-creation-enabled", adminAuth, async (request) => {
    const payload = request.body as { enabled: boolean };
    await fastify.settingsService.updateAccountCreationEnabled(Boolean(payload.enabled));
    const accountCreationEnabled = await fastify.settingsService.accountCreationEnabled();
    return { accountCreationEnabled };
  });

  fastify.patch("/internal/admin/settings/password-auth-enabled", adminAuth, async (request) => {
    const payload = request.body as { enabled: boolean };
    return fastify.authService.updatePasswordAuthEnabled(Boolean(payload.enabled));
  });

  // ── OIDC providers ──

  fastify.get("/internal/admin/oidc/providers", adminAuth, async () => {
    return {
      providers: await fastify.authOidcService.listOidcProviderConfigs(),
    };
  });

  fastify.post("/internal/admin/oidc/providers", adminAuth, async (request) => {
    const payload = request.body as {
      providerId: string;
      label: string;
      issuerUrl: string;
      clientId: string;
      clientSecret: string;
      scopes?: string;
      enabled?: boolean;
    };
    return fastify.authOidcService.createOidcProviderConfig(payload);
  });

  fastify.patch("/internal/admin/oidc/providers/:providerId", adminAuth, async (request) => {
    const { providerId } = request.params as { providerId: string };
    const payload = request.body as {
      label?: string;
      issuerUrl?: string;
      clientId?: string;
      clientSecret?: string;
      scopes?: string;
      enabled?: boolean;
    };
    return fastify.authOidcService.updateOidcProviderConfig(providerId, payload);
  });

  fastify.delete("/internal/admin/oidc/providers/:providerId", adminAuth, async (request) => {
    const { providerId } = request.params as { providerId: string };
    return fastify.authOidcService.deleteOidcProviderConfig(providerId);
  });

  // ── Users ──

  fastify.post("/internal/admin/users", adminAuth, async (request) => {
    const payload = request.body as {
      email: string;
      displayName: string;
      password?: string;
      isAdmin?: boolean;
    };
    const user = await fastify.authAdminService.upsertAdminManagedUser(null, {
      email: payload.email,
      displayName: payload.displayName,
      password: payload.password,
      isAdmin: Boolean(payload.isAdmin),
    });

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  });

  fastify.patch("/internal/admin/users/:userId", adminAuth, async (request) => {
    const { userId } = request.params as { userId: string };
    const payload = request.body as {
      email: string;
      displayName: string;
      password?: string;
      isAdmin?: boolean;
    };
    const user = await fastify.authAdminService.upsertAdminManagedUser(userId, {
      email: payload.email,
      displayName: payload.displayName,
      password: payload.password,
      isAdmin: Boolean(payload.isAdmin),
    });

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  });

  // ── Storage config ──

  fastify.get("/internal/admin/storage/config", adminAuth, async () => {
    const backend = await fastify.settingsService.getStorageBackend();
    const filesystemRoot = await fastify.settingsService.getStorageFilesystemRoot();
    const s3Endpoint = await fastify.settingsService.getStorageS3Endpoint();
    const s3Bucket = await fastify.settingsService.getStorageS3Bucket();
    const s3AccessKeyId = await fastify.settingsService.getStorageS3AccessKeyId();
    return { backend, filesystemRoot, s3Endpoint, s3Bucket, s3AccessKeyId };
  });

  fastify.patch("/internal/admin/storage/config", adminAuth, async (request) => {
    const payload = request.body as {
      backend?: string;
      filesystemRoot?: string;
      s3Endpoint?: string;
      s3Bucket?: string;
      s3AccessKeyId?: string;
      s3SecretAccessKey?: string;
    };

    if (payload.backend) {
      await fastify.settingsService.setSettingValue(AppConfigName.STORAGE_BACKEND, payload.backend);
    }
    if (payload.filesystemRoot) {
      await fastify.settingsService.setSettingValue(
        AppConfigName.STORAGE_FILESYSTEM_ROOT,
        payload.filesystemRoot,
      );
    }
    if (payload.s3Endpoint !== undefined) {
      await fastify.settingsService.setSettingValue(
        AppConfigName.STORAGE_S3_ENDPOINT,
        payload.s3Endpoint,
      );
    }
    if (payload.s3Bucket !== undefined) {
      await fastify.settingsService.setSettingValue(
        AppConfigName.STORAGE_S3_BUCKET,
        payload.s3Bucket,
      );
    }
    if (payload.s3AccessKeyId !== undefined) {
      await fastify.settingsService.setSettingValue(
        AppConfigName.STORAGE_S3_ACCESS_KEY_ID,
        payload.s3AccessKeyId,
      );
    }
    if (payload.s3SecretAccessKey !== undefined) {
      await fastify.settingsService.setSettingValue(
        AppConfigName.STORAGE_S3_SECRET_ACCESS_KEY,
        payload.s3SecretAccessKey,
      );
    }

    await fastify.storageService.reinitialize();

    // Return updated config
    const backend = await fastify.settingsService.getStorageBackend();
    const filesystemRoot = await fastify.settingsService.getStorageFilesystemRoot();
    const s3Endpoint = await fastify.settingsService.getStorageS3Endpoint();
    const s3Bucket = await fastify.settingsService.getStorageS3Bucket();
    const s3AccessKeyId = await fastify.settingsService.getStorageS3AccessKeyId();
    return { backend, filesystemRoot, s3Endpoint, s3Bucket, s3AccessKeyId };
  });

  // ── Calendar config ──

  fastify.get("/internal/admin/calendar/config", adminAuth, async () => {
    const clientId = await fastify.settingsService.getGoogleCalendarClientId();
    return {
      clientId,
      hasClientSecret: Boolean(await fastify.settingsService.getGoogleCalendarClientSecret()),
    };
  });

  fastify.patch("/internal/admin/calendar/config", adminAuth, async (request) => {
    const payload = request.body as { clientId?: string; clientSecret?: string };
    if (payload.clientId !== undefined) {
      await fastify.settingsService.setGoogleCalendarClientId(payload.clientId);
    }
    if (payload.clientSecret !== undefined) {
      await fastify.settingsService.setGoogleCalendarClientSecret(payload.clientSecret);
    }
    // Return updated config
    const clientId = await fastify.settingsService.getGoogleCalendarClientId();
    return {
      clientId,
      hasClientSecret: Boolean(await fastify.settingsService.getGoogleCalendarClientSecret()),
    };
  });

  // ── Storage migrate ──

  fastify.post("/internal/admin/storage/migrate", adminAuth, async (request) => {
    const payload = request.body as { fromBackend: string; toBackend: string };
    const attachments = await fastify.prisma.attachment.findMany({
      where: { status: { in: ["uploaded", "processed"] } },
      select: { id: true },
    });

    for (const attachment of attachments) {
      await fastify.jobsService.enqueue("storage-migrate", {
        attachmentId: attachment.id,
        fromType: payload.fromBackend,
        toType: payload.toBackend,
      });
    }

    return { enqueued: attachments.length };
  });

  // ── Storage garbage collection ──

  fastify.post("/internal/admin/storage/gc", adminAuth, async (request) => {
    const payload = (request.body ?? {}) as {
      orphanAfterMs?: number;
      deleteAfterMs?: number;
    };
    await fastify.jobHandlers.runGarbageCollection({
      orphanAfterMs: payload.orphanAfterMs ?? 0,
      deleteAfterMs: payload.deleteAfterMs ?? 0,
    });
    return { ok: true };
  });
}
