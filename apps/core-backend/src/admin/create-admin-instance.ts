import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildAdminResources, fetchDashboardStats, fetchPgBossStats } from "./adminjs-resources";
import { SlatePrismaResource } from "./slate-prisma-resource";

async function importEsm<T>(specifier: string): Promise<T> {
  const dynamicImport = new Function("specifier", "return import(specifier);") as (
    value: string,
  ) => Promise<T>;
  return dynamicImport(specifier);
}

export async function createAdminJsInstance(fastify: FastifyInstance) {
  const [adminjsMod, prismaAdapterMod] = await Promise.all([
    importEsm<{
      default: {
        new (options: unknown): {
          options: { rootPath: string; loginPath: string; logoutPath: string };
          initialize: () => Promise<void>;
          watch: () => Promise<void>;
          renderLogin: (props: Record<string, unknown>) => Promise<string>;
        };
        registerAdapter: (adapter: { Database: unknown; Resource: unknown }) => void;
      };
      ComponentLoader: new () => { add: (name: string, componentPath: string) => string };
      Router: {
        assets: Array<{ path: string; src: string }>;
        routes: Array<{
          action: string;
          contentType?: string;
          Controller: new (
            args: { admin: unknown },
            currentAdmin?: unknown,
          ) => Record<string, (request: unknown, reply: unknown) => Promise<unknown>>;
          method: "GET" | "POST";
          path: string;
        }>;
      };
    }>("adminjs"),
    importEsm<{
      Database: unknown;
      Resource: unknown;
      getModelByName: (name: string) => unknown;
    }>("@adminjs/prisma"),
  ]);

  const AdminJS = adminjsMod.default;
  const { ComponentLoader } = adminjsMod;
  const { Database, getModelByName } = prismaAdapterMod;

  AdminJS.registerAdapter({ Database, Resource: SlatePrismaResource });

  const componentLoader = new ComponentLoader();
  const componentsDir = path.join(__dirname, "components");
  const dashboardComponent = componentLoader.add(
    "Dashboard",
    path.join(componentsDir, "dashboard"),
  );
  const plainTextComponent = componentLoader.add(
    "PlainText",
    path.join(componentsDir, "plain-text"),
  );
  const jsonTextComponent = componentLoader.add(
    "JsonText",
    path.join(componentsDir, "json-text"),
  );
  const pgBossComponent = componentLoader.add(
    "PgBossDashboard",
    path.join(componentsDir, "pgboss-dashboard"),
  );

  const admin = new AdminJS({
    rootPath: "/admin",
    componentLoader,
    branding: { companyName: "Slate Admin" },
    dashboard: {
      component: dashboardComponent,
      handler: async () => fetchDashboardStats(fastify),
    },
    pages: {
      pgboss: {
        component: pgBossComponent,
        handler: async (request: { query?: Record<string, unknown> }) => {
          const runSchedule =
            typeof request?.query?.runSchedule === "string" ? request.query.runSchedule : "";
          let ran: { name: string } | null = null;
          let runError: string | null = null;
          if (runSchedule) {
            try {
              await fastify.jobsService.enqueue(runSchedule, {});
              ran = { name: runSchedule };
              fastify.log.info({ queue: runSchedule }, "admin: manually triggered schedule");
            } catch (err) {
              runError = err instanceof Error ? err.message : "Failed to enqueue job";
              fastify.log.error(
                { err, queue: runSchedule },
                "admin: failed to manually trigger schedule",
              );
            }
          }
          const stats = await fetchPgBossStats(fastify);
          return { ...stats, ran, runError };
        },
        icon: "Activity",
      },
    },
    resources: buildAdminResources(
      fastify,
      fastify.prisma,
      getModelByName,
      plainTextComponent,
      jsonTextComponent,
    ),
  });

  return { admin, AdminRouter: adminjsMod.Router };
}
