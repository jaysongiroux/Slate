import type { FastifyInstance } from "fastify";

const NOTE_SELECT = {
  id: true,
  title: true,
  path: true,
  pinned: true,
  isTemplate: true,
  createdAt: true,
  updatedAt: true,
} as const;

export default async function notesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get("/api/notes/sync", auth, async (request) => {
    const since = (request.query as { since?: string }).since;
    const sinceDate = since ? new Date(since) : new Date(0);
    return fastify.prisma.document.findMany({
      where: { userId: request.user!.userId, updatedAt: { gt: sinceDate } },
      select: { ...NOTE_SELECT, deleted: true },
      orderBy: { updatedAt: "asc" },
    });
  });

  fastify.get("/api/notes", auth, async (request) => {
    return fastify.prisma.document.findMany({
      where: { userId: request.user!.userId, deleted: false },
      select: NOTE_SELECT,
      orderBy: { updatedAt: "desc" },
    });
  });

  fastify.post("/api/notes", auth, async (request) => {
    const body = request.body as { id?: string; path: string; title: string };
    return fastify.prisma.document.create({
      data: {
        ...(body.id ? { id: body.id } : {}),
        userId: request.user!.userId,
        path: body.path,
        title: body.title,
        content: {},
        markdown: "",
      },
      select: NOTE_SELECT,
    });
  });

  fastify.patch("/api/notes/:id", auth, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      path?: string;
      title?: string;
      pinned?: boolean;
      deleted?: boolean;
    };
    return fastify.prisma.document.update({
      where: { id, userId: request.user!.userId },
      data: {
        ...(body.path !== undefined ? { path: body.path } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
        ...(body.deleted !== undefined ? { deleted: body.deleted } : {}),
      },
      select: NOTE_SELECT,
    });
  });

  fastify.delete("/api/notes/:id", auth, async (request) => {
    const { id } = request.params as { id: string };
    await fastify.prisma.document.delete({
      where: { id, userId: request.user!.userId },
    });
    return {};
  });

  fastify.post("/api/notes/import", auth, async (request) => {
    const body = request.body as {
      notes: Array<{
        id?: string;
        path: string;
        title: string;
        markdown?: string;
      }>;
    };
    const userId = request.user!.userId;

    const existing = await fastify.prisma.document.findMany({
      where: { userId, deleted: false },
      select: { path: true },
    });
    const usedPaths = new Set(existing.map((d) => d.path));

    const prepared = body.notes.map((note) => {
      let candidate = note.path;
      let counter = 1;
      while (usedPaths.has(candidate)) {
        candidate = `${note.path}-${counter++}`;
      }
      usedPaths.add(candidate);

      return {
        ...(note.id ? { id: note.id } : {}),
        userId,
        path: candidate,
        title: note.title,
        content: {},
        markdown: note.markdown ?? "",
      };
    });

    const importPaths = prepared.map((d) => d.path);
    const created = await fastify.prisma.$transaction([
      fastify.prisma.document.deleteMany({
        where: { userId, path: { in: importPaths }, deleted: true },
      }),
      ...prepared.map((data) => fastify.prisma.document.create({ data, select: NOTE_SELECT })),
    ]);
    return { created: created.slice(1) };
  });
}
