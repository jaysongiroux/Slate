import type { FastifyInstance } from "fastify";

export default async function graphRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get("/api/graph", auth, async (request, reply) => {
    const userId = request.user!.userId;
    const payload = await fastify.noteGraphService.getGraphPayload(userId);
    if (!payload) {
      return reply.code(404).send({ error: "note_graph_disabled" });
    }
    return payload;
  });

  fastify.delete("/api/graph", auth, async (request) => {
    const userId = request.user!.userId;
    await fastify.noteGraphService.deleteAllEdgesForUser(userId);
    return { ok: true };
  });

  fastify.post("/api/graph/rebuild", auth, async (request, reply) => {
    const userId = request.user!.userId;
    const totalDocs = await fastify.prisma.document.count({
      where: { userId, deleted: false },
    });
    if (totalDocs === 0) {
      return { ok: true, enqueued: false };
    }
    const configured = await fastify.noteGraphService.hasEmbeddingConfigured(userId);
    if (!configured) {
      return reply.code(400).send({ error: "embedding_not_configured" });
    }
    const jobId = await fastify.jobsService.enqueue(
      "note-graph-rebuild",
      { userId, force: true },
      { expireInHours: 2 },
    );
    return { ok: true, enqueued: Boolean(jobId), jobId };
  });

  fastify.get<{ Params: { jobId: string } }>(
    "/api/graph/rebuild/:jobId",
    {
      ...auth,
      schema: {
        params: { type: "object", properties: { jobId: { type: "string", format: "uuid" } } },
      },
    },
    async (request, reply) => {
      const state = await fastify.jobsService.graphRebuildState(
        request.user!.userId,
        request.params.jobId,
      );
      return state ? { state } : reply.code(404).send({ error: "rebuild_not_found" });
    },
  );
}
