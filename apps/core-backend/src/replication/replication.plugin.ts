import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { SseEventBus } from "./sse-event-bus";
import { registerNotesReplication } from "./notes.replication";
import { registerFoldersReplication } from "./folders.replication";
import { registerSettingsReplication } from "./settings.replication";
import { registerConflictsReplication } from "./conflicts.replication";

export default fp(async function replicationPlugin(fastify: FastifyInstance) {
  const eventBus = new SseEventBus();
  fastify.decorate("sseEventBus", eventBus);

  await registerNotesReplication(fastify, eventBus);
  await registerFoldersReplication(fastify, eventBus);
  await registerSettingsReplication(fastify, eventBus);
  await registerConflictsReplication(fastify);
});
