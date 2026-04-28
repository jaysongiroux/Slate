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

  fastify.post("/api/diagrams/bulk-import", auth, async (request, reply) => {
    const { diagrams } = request.body as {
      diagrams: Array<{
        id: string;
        title: string;
        scene: unknown;
        createdAt: string;
        updatedAt: string;
      }>;
    };
    if (!Array.isArray(diagrams)) {
      reply.code(400);
      return { error: "diagrams must be an array" };
    }
    if (diagrams.length > 200) {
      reply.code(400);
      return { error: "diagrams per request must be <= 200" };
    }

    const userId = request.user!.userId;
    let imported = 0;
    let skipped = 0;

    for (const dg of diagrams) {
      const incumbent = await fastify.prisma.diagram.findUnique({ where: { id: dg.id } });
      if (incumbent && incumbent.userId !== userId) {
        skipped++;
        continue;
      }
      if (incumbent) {
        await fastify.prisma.diagram.update({
          where: { id: dg.id },
          data: {
            title: dg.title,
            scene: dg.scene as Prisma.InputJsonValue,
            deleted: false,
          },
        });
      } else {
        await fastify.prisma.diagram.create({
          data: {
            id: dg.id,
            userId,
            title: dg.title,
            scene: dg.scene as Prisma.InputJsonValue,
          },
        });
      }
      imported++;
    }

    return { imported, skipped };
  });
}
