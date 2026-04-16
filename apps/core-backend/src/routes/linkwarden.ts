import type { FastifyInstance } from "fastify";

export default async function linkwardenRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get("/api/linkwarden/instances", auth, async (request) => {
    return { instances: await fastify.linkwardenService.listInstances(request.user!.userId) };
  });

  fastify.post("/api/linkwarden/instances", auth, async (request, reply) => {
    const { url, token, name } = request.body as { url: string; token: string; name?: string };
    try {
      const instance = await fastify.linkwardenService.addInstance(
        request.user!.userId,
        url,
        token,
        name,
      );
      return { instance };
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : "Failed to connect." });
    }
  });

  fastify.delete("/api/linkwarden/instances/:id", auth, async (request) => {
    const { id } = request.params as { id: string };
    await fastify.linkwardenService.removeInstance(request.user!.userId, id);
    return { ok: true };
  });

  fastify.get("/api/linkwarden/:instanceId/links", auth, async (request) => {
    const { instanceId } = request.params as { instanceId: string };
    const query = request.query as {
      collectionId?: string;
      tagId?: string;
      searchQueryString?: string;
      cursor?: string;
      sort?: string;
    };
    return fastify.linkwardenService.getLinks(request.user!.userId, instanceId, {
      collectionId: query.collectionId ? Number(query.collectionId) : undefined,
      tagId: query.tagId ? Number(query.tagId) : undefined,
      searchQueryString: query.searchQueryString,
      cursor: query.cursor ? Number(query.cursor) : undefined,
      sort: query.sort ? Number(query.sort) : undefined,
    });
  });

  fastify.get("/api/linkwarden/:instanceId/collections", auth, async (request) => {
    const { instanceId } = request.params as { instanceId: string };
    return fastify.linkwardenService.getCollections(request.user!.userId, instanceId);
  });

  fastify.get("/api/linkwarden/:instanceId/tags", auth, async (request) => {
    const { instanceId } = request.params as { instanceId: string };
    return fastify.linkwardenService.getTags(request.user!.userId, instanceId);
  });

  const imgAuth = { preHandler: [fastify.authenticateAttachment] };

  fastify.get("/api/linkwarden/:instanceId/preview/:linkId", imgAuth, async (request, reply) => {
    const { instanceId, linkId } = request.params as { instanceId: string; linkId: string };
    const result = await fastify.linkwardenService.proxyRaw(
      request.userSession!.userId,
      instanceId,
      `/api/v1/archives/${linkId}?format=1&preview=true`,
    );
    if (!result.body || result.status !== 200) {
      return reply.code(result.status || 404).send();
    }
    reply.header("Content-Type", result.contentType);
    reply.header("Cache-Control", "private, max-age=3600");
    return reply.send(result.body);
  });

  fastify.get("/api/linkwarden/:instanceId/dashboard", auth, async (request) => {
    const { instanceId } = request.params as { instanceId: string };
    return fastify.linkwardenService.getDashboard(request.user!.userId, instanceId);
  });

  fastify.post("/api/linkwarden/:instanceId/links", auth, async (request) => {
    const { instanceId } = request.params as { instanceId: string };
    const body = request.body as {
      url: string;
      name?: string;
      description?: string;
      collection?: { id: number };
      tags?: string[];
    };
    return fastify.linkwardenService.createLink(request.user!.userId, instanceId, body);
  });
}
