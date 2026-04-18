import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

// Settings
import { SettingsService } from "../settings/settings.service";

// Auth
import { AuthService } from "../auth/auth.service";
import { AuthOidcService } from "../auth/auth-oidc.service";
import { AuthAdminService } from "../auth/auth-admin.service";

// Documents
import { MaterializeService } from "../materialization/materialize.service";

// Storage & Attachments
import { StorageService } from "../storage/storage.service";
import { AttachmentsService } from "../attachments/attachments.service";

// Search
import { SearchService } from "../search/search.service";

// Calendar
import { GoogleCalendarProvider } from "../calendar/google-calendar.provider";
import { IcsService } from "../calendar/ics.service";
import { CalendarService } from "../calendar/calendar.service";
import { ContactCacheService } from "../calendar/contact-cache.service";

// LinkWarden
import { LinkwardenService } from "../linkwarden/linkwarden.service";

// Jira
import { JiraService } from "../jira/jira.service";

// AI
import { ChunkingService } from "../ai/chunking.service";
import { AiConfigService } from "../ai/ai-config.service";
import { ModelProviderService } from "../ai/model-provider.service";
import { ConversationService } from "../ai/conversation.service";
import { EmbeddingService } from "../ai/embedding.service";
import { AgentService } from "../ai/agent.service";

// Jobs
import { JobsService } from "../jobs/jobs.service";
import { JobHandlersService } from "../jobs/job-handlers.service";
import { NoteGraphService } from "../graph/note-graph.service";

export default fp(async function servicesPlugin(fastify: FastifyInstance) {
  const { prisma, config } = fastify;

  // ---------------------------------------------------------------------------
  // JWT helpers — thin wrappers around @fastify/jwt (registered by auth plugin)
  // ---------------------------------------------------------------------------
  const jwtSign = (payload: object, options?: object) =>
    fastify.jwt.sign(payload as Record<string, unknown>, options);
  const jwtVerify = async (token: string) => fastify.jwt.verify(token);

  // ---------------------------------------------------------------------------
  // Jobs — needed by DocumentsService & AiConfigService
  // ---------------------------------------------------------------------------
  const jobsService = new JobsService(config, fastify.log.child({ component: "jobs" }));
  fastify.decorate("jobsService", jobsService);

  // ---------------------------------------------------------------------------
  // 1. SettingsService
  // ---------------------------------------------------------------------------
  const settingsService = new SettingsService(prisma, config);
  await settingsService.init();
  fastify.decorate("settingsService", settingsService);

  // ---------------------------------------------------------------------------
  // 2. AuthService
  // ---------------------------------------------------------------------------
  const authService = new AuthService(prisma, config, settingsService, jwtSign, jwtVerify);
  fastify.decorate("authService", authService);

  // ---------------------------------------------------------------------------
  // 3. AuthOidcService
  // ---------------------------------------------------------------------------
  const authOidcService = new AuthOidcService(
    prisma,
    config,
    settingsService,
    jwtSign,
    authService.issueTokens.bind(authService),
  );
  fastify.decorate("authOidcService", authOidcService);

  // ---------------------------------------------------------------------------
  // 4. AuthAdminService
  // ---------------------------------------------------------------------------
  const authAdminService = new AuthAdminService(
    prisma,
    config,
    jwtSign,
    jwtVerify,
    authService.createPasswordAccount.bind(authService),
    authService.normalizeUsername.bind(authService),
    authService.passwordAuthEnabled.bind(authService),
  );
  fastify.decorate("authAdminService", authAdminService);

  // ---------------------------------------------------------------------------
  // 5. MaterializeService
  // ---------------------------------------------------------------------------
  const materializeService = new MaterializeService();
  fastify.decorate("materializeService", materializeService);

  // ---------------------------------------------------------------------------
  // 6. StorageService
  // ---------------------------------------------------------------------------
  const storageService = new StorageService(settingsService);
  fastify.decorate("storageService", storageService);

  // ---------------------------------------------------------------------------
  // 8. AttachmentsService
  // ---------------------------------------------------------------------------
  const attachmentsService = new AttachmentsService(prisma, storageService);
  fastify.decorate("attachmentsService", attachmentsService);

  // ---------------------------------------------------------------------------
  // 9. SearchService
  // ---------------------------------------------------------------------------
  const searchService = new SearchService(prisma);
  fastify.decorate("searchService", searchService);

  // ---------------------------------------------------------------------------
  // 10. GoogleCalendarProvider
  // ---------------------------------------------------------------------------
  const googleCalendarProvider = new GoogleCalendarProvider(config, settingsService);
  fastify.decorate("googleCalendarProvider", googleCalendarProvider);

  // ---------------------------------------------------------------------------
  // 11. IcsService
  // ---------------------------------------------------------------------------
  const icsService = new IcsService(prisma, config);
  fastify.decorate("icsService", icsService);

  // ---------------------------------------------------------------------------
  // 12a. ContactCacheService
  // ---------------------------------------------------------------------------
  const contactCacheService = new ContactCacheService(prisma);

  // ---------------------------------------------------------------------------
  // 12. CalendarService
  // ---------------------------------------------------------------------------
  const calendarService = new CalendarService(
    prisma,
    config,
    googleCalendarProvider,
    contactCacheService,
  );
  fastify.decorate("calendarService", calendarService);

  // ---------------------------------------------------------------------------
  // 13. ChunkingService
  // ---------------------------------------------------------------------------
  const chunkingService = new ChunkingService();
  fastify.decorate("chunkingService", chunkingService);

  // ---------------------------------------------------------------------------
  // 14. AiConfigService
  // ---------------------------------------------------------------------------
  const aiConfigService = new AiConfigService(prisma, config, jobsService);
  fastify.decorate("aiConfigService", aiConfigService);

  // ---------------------------------------------------------------------------
  // 15. ModelProviderService
  // ---------------------------------------------------------------------------
  const modelProviderService = new ModelProviderService(aiConfigService);
  fastify.decorate("modelProviderService", modelProviderService);

  // ---------------------------------------------------------------------------
  // 16. ConversationService
  // ---------------------------------------------------------------------------
  const conversationService = new ConversationService(prisma);
  fastify.decorate("conversationService", conversationService);

  // ---------------------------------------------------------------------------
  // 17. EmbeddingService
  // ---------------------------------------------------------------------------
  const embeddingService = new EmbeddingService(prisma, modelProviderService, chunkingService);
  fastify.decorate("embeddingService", embeddingService);

  // ---------------------------------------------------------------------------
  // 17b. NoteGraphService
  // ---------------------------------------------------------------------------
  const noteGraphService = new NoteGraphService(prisma, jobsService);
  fastify.decorate("noteGraphService", noteGraphService);

  // ---------------------------------------------------------------------------
  // 18. AgentService
  // ---------------------------------------------------------------------------
  const agentService = new AgentService(
    prisma,
    modelProviderService,
    aiConfigService,
    conversationService,
    searchService,
    calendarService,
    icsService,
  );
  fastify.decorate("agentService", agentService);

  // ---------------------------------------------------------------------------
  // 19. JobHandlersService — registers workers & schedules
  // ---------------------------------------------------------------------------
  const jobHandlers = new JobHandlersService(
    jobsService,
    prisma,
    storageService,
    embeddingService,
    materializeService,
    config,
    noteGraphService,
    fastify.log.child({ component: "job-handlers" }),
  );
  await jobHandlers.init();
  fastify.decorate("jobHandlers", jobHandlers);

  // ---------------------------------------------------------------------------
  // LinkwardenService
  // ---------------------------------------------------------------------------
  const linkwardenService = new LinkwardenService(
    prisma,
    config.get("ENCRYPTION_SECRET", "local-dev-encryption-secret"),
  );
  fastify.decorate("linkwardenService", linkwardenService);

  // ---------------------------------------------------------------------------
  // JiraService
  // ---------------------------------------------------------------------------
  const jiraService = new JiraService(
    prisma,
    config.get("ENCRYPTION_SECRET", "local-dev-encryption-secret"),
  );
  fastify.decorate("jiraService", jiraService);

  // Daily contact cache garbage collection
  const gcInterval = setInterval(
    () => {
      contactCacheService.gc().catch((err) => {
        fastify.log.warn({ err }, "Contact cache GC failed");
      });
    },
    24 * 60 * 60 * 1000,
  );

  fastify.addHook("onClose", () => clearInterval(gcInterval));

  // ---------------------------------------------------------------------------
  // Cleanup hooks
  // ---------------------------------------------------------------------------
  fastify.addHook("onClose", async () => {
    await jobsService.destroy();
  });

  fastify.log.info("All services registered");
});
