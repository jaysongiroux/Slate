import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";

export default async function diagramsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get("/api/diagrams", auth, async (request) => {
    return fastify.diagramsService.list({ userId: request.user!.userId });
  });

  fastify.get("/api/diagrams/:id", auth, async (request) => {
    const { id } = request.params as { id: string };
    return fastify.diagramsService.get({ userId: request.user!.userId, id });
  });

  fastify.post("/api/diagrams", auth, async (request) => {
    const body = (request.body ?? {}) as { title?: string };
    return fastify.diagramsService.create({
      userId: request.user!.userId,
      title: body.title?.trim() || "Untitled Diagram",
    });
  });

  fastify.patch("/api/diagrams/:id", auth, async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { title?: string; scene?: unknown };
    return fastify.diagramsService.update({
      userId: request.user!.userId,
      id,
      title: body.title,
      scene: body.scene as Prisma.InputJsonValue,
    });
  });

  fastify.delete("/api/diagrams/:id", auth, async (request) => {
    const { id } = request.params as { id: string };
    await fastify.diagramsService.softDelete({ userId: request.user!.userId, id });
    return {};
  });
}
