import "./config/env"; // Load dotenv FIRST (same as current main.ts)
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import formbody from "@fastify/formbody";
import { createConfig } from "./lib/config";

// Plugins
import prismaPlugin from "./plugins/prisma";
import jsonBigIntPlugin from "./plugins/json-bigint";
import authPlugin from "./plugins/auth";
import servicesPlugin from "./plugins/services";
import replicationPlugin from "./replication/replication.plugin";

// Routes
import healthRoutes from "./routes/health";
import authRoutes from "./routes/auth";
import notesRoutes from "./routes/notes";
import diagramsRoutes from "./routes/diagrams";
import attachmentsRoutes from "./routes/attachments";
import calendarRoutes from "./routes/calendar";
import aiRoutes from "./routes/ai";
import graphRoutes from "./routes/graph";
import linkwardenRoutes from "./routes/linkwarden";
import jiraRoutes from "./routes/jira";
import homeAssistantRoutes from "./routes/home-assistant";
import mcpRoutes from "./routes/mcp";
import adminRoutes from "./routes/admin";
import adminPlugin from "./admin/plugin";
import adminUiRoutes from "./admin/routes";

export async function buildApp(options: { logger?: boolean | object } = {}) {
  const fastify = Fastify({
    logger: options.logger ?? {
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  const config = createConfig();
  fastify.decorate("config", config);

  // Core plugins (order matters)
  await fastify.register(cors);
  await fastify.register(multipart, { attachFieldsToBody: true });
  await fastify.register(formbody);
  await fastify.register(prismaPlugin);
  await fastify.register(jsonBigIntPlugin);
  await fastify.register(authPlugin);
  await fastify.register(servicesPlugin);
  await fastify.register(replicationPlugin);

  // Routes
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(notesRoutes);
  await fastify.register(diagramsRoutes);
  await fastify.register(attachmentsRoutes);
  await fastify.register(calendarRoutes);
  await fastify.register(aiRoutes);
  await fastify.register(graphRoutes);
  await fastify.register(linkwardenRoutes);
  await fastify.register(jiraRoutes);
  await fastify.register(homeAssistantRoutes);
  await fastify.register(mcpRoutes);
  await fastify.register(adminRoutes);
  if (process.env.NODE_ENV !== "test") {
    await fastify.register(adminPlugin);
  }
  await fastify.register(adminUiRoutes);

  return fastify;
}

// Start server when run directly
async function start() {
  const app = await buildApp();
  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen({ port, host: "0.0.0.0" });
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
