import type { PrismaClient } from "@slate/server-db";
import type { FastifyRequest, FastifyReply } from "fastify";

// Service type imports
import type { SettingsService } from "../settings/settings.service";
import type { AuthService } from "../auth/auth.service";
import type { AuthOidcService } from "../auth/auth-oidc.service";
import type { AuthAdminService } from "../auth/auth-admin.service";
import type { AuthSessionService } from "../auth/auth-session.service";
import type { StorageService } from "../storage/storage.service";
import type { AttachmentsService } from "../attachments/attachments.service";
import type { DiagramsService } from "../diagrams/diagrams.service";
import type { SearchService } from "../search/search.service";
import type { CalendarService } from "../calendar/calendar.service";
import type { GoogleCalendarProvider } from "../calendar/google-calendar.provider";
import type { IcsService } from "../calendar/ics.service";
import type { AiConfigService } from "../ai/ai-config.service";
import type { ConversationService } from "../ai/conversation.service";
import type { AgentService } from "../ai/agent.service";
import type { EmbeddingService } from "../ai/embedding.service";
import type { ModelProviderService } from "../ai/model-provider.service";
import type { ChunkingService } from "../ai/chunking.service";
import type { JobsService } from "../jobs/jobs.service";
import type { JobHandlersService } from "../jobs/job-handlers.service";
import type { NoteGraphService } from "../graph/note-graph.service";
import type { LinkwardenService } from "../linkwarden/linkwarden.service";
import type { JiraService } from "../jira/jira.service";
import type { HomeAssistantService } from "../home-assistant/home-assistant.service";
import type { McpService } from "../mcp/mcp.service";
import type { McpAdapter } from "../mcp/mcp.adapter";
import type { McpHealthCache } from "../mcp/mcp.health";
import type { SseEventBus } from "../replication/sse-event-bus";
import type { MaterializeService } from "../materialization/materialize.service";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface UserSession {
  userId: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export interface AdminUser {
  userId: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export interface AppConfig {
  get(key: string, defaultValue?: string): string;
}

// ---------------------------------------------------------------------------
// Fastify module augmentation
// ---------------------------------------------------------------------------

declare module "@fastify/jwt" {
  interface FastifyJWT {
    user: UserSession;
  }
}

declare module "fastify" {
  interface Session {
    adminUser?: {
      id: string;
      email: string;
      displayName: string;
      isAdmin: boolean;
      /** Bearer token for in-process calls to `/internal/admin/*` from AdminJS actions */
      accessToken?: string;
    };
    redirectTo?: string;
  }

  interface FastifyInstance {
    prisma: PrismaClient;
    config: AppConfig;

    // Core services
    settingsService: SettingsService;
    authService: AuthService;
    authOidcService: AuthOidcService;
    authAdminService: AuthAdminService;
    authSession: AuthSessionService;
    storageService: StorageService;
    attachmentsService: AttachmentsService;
    diagramsService: DiagramsService;
    searchService: SearchService;

    // Calendar
    calendarService: CalendarService;
    googleCalendarProvider: GoogleCalendarProvider;
    icsService: IcsService;

    // LinkWarden
    linkwardenService: LinkwardenService;

    // Jira
    jiraService: JiraService;

    // Home Assistant
    homeAssistantService: HomeAssistantService;

    // MCP
    mcpService: McpService;
    mcpAdapter: McpAdapter;
    mcpHealth: McpHealthCache;

    // AI
    aiConfigService: AiConfigService;
    conversationService: ConversationService;
    agentService: AgentService;
    embeddingService: EmbeddingService;
    modelProviderService: ModelProviderService;
    chunkingService: ChunkingService;
    noteGraphService: NoteGraphService;

    // Jobs
    jobsService: JobsService;
    jobHandlers: JobHandlersService;

    // Replication
    sseEventBus: SseEventBus;
    materializeService: MaterializeService;

    // Auth preHandlers
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateAttachment: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    adminUser?: AdminUser;
    userSession?: { userId: string };
  }
}
