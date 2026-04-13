import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildAdminResources, fetchDashboardStats, fetchPgBossStats } from "./adminjs-resources";

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
  const { Database, Resource: PrismaResource, getModelByName } = prismaAdapterMod;

  /**
   * @adminjs/prisma maps Prisma scalars in DATA_TYPES but not Bytes; Property.type() then
   * logs "Unhandled type: Bytes" and returns undefined. Document.crdtState is Bytes — omit
   * those columns from AdminJS entirely (binary Yjs state is not useful in the admin UI).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma Resource is loaded via dynamic import
  class SlatePrismaResource extends (PrismaResource as any) {
    prepareProperties() {
      const props = super.prepareProperties() as Record<string, { column?: { type?: string } }>;
      return Object.fromEntries(
        Object.entries(props).filter(([, property]) => property.column?.type !== "Bytes"),
      );
    }
  }

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
        handler: async () => fetchPgBossStats(fastify),
        icon: "Activity",
      },
    },
    resources: buildAdminResources(fastify, fastify.prisma, getModelByName, plainTextComponent),
  });

  return { admin, AdminRouter: adminjsMod.Router };
}
