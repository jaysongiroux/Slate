import type { FastifyInstance } from "fastify";

interface ConflictRequest {
  folders?: string[];
  notes?: string[];
  diagrams?: string[];
  attachments?: string[];
  settings?: string[];
}

interface ConflictResponse {
  folders: string[];
  notes: string[];
  diagrams: string[];
  attachments: string[];
  settings: string[];
}

/**
 * Returns the subset of caller-provided IDs that already exist on the server
 * but are owned by a *different* user. The migration uses this to decide
 * whether to regenerate IDs before pushing.
 *
 * IDs that don't exist anywhere, or that belong to the authenticated user,
 * are NOT returned — those are safe to upsert as-is.
 */
export async function registerConflictsReplication(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.post("/api/replication/check-id-conflicts", auth, async (request) => {
    const body = (request.body ?? {}) as ConflictRequest;
    const userId = request.user!.userId;

    async function crossUserIds(
      ids: string[] | undefined,
      finder: (id: string[]) => Promise<Array<{ id: string; userId: string }>>,
    ): Promise<string[]> {
      if (!ids || ids.length === 0) return [];
      // Cap individual queries to keep the round-trip bounded — callers can
      // always chunk if they have huge collections, but in practice no user
      // has hundreds of thousands of any of these.
      const capped = ids.slice(0, 5000);
      const rows = await finder(capped);
      return rows.filter((r) => r.userId !== userId).map((r) => r.id);
    }

    const [folders, notes, diagrams, attachments, settings] = await Promise.all([
      crossUserIds(body.folders, (ids) =>
        fastify.prisma.folder.findMany({
          where: { id: { in: ids } },
          select: { id: true, userId: true },
        }),
      ),
      crossUserIds(body.notes, (ids) =>
        fastify.prisma.document.findMany({
          where: { id: { in: ids } },
          select: { id: true, userId: true },
        }),
      ),
      crossUserIds(body.diagrams, (ids) =>
        fastify.prisma.diagram.findMany({
          where: { id: { in: ids } },
          select: { id: true, userId: true },
        }),
      ),
      crossUserIds(body.attachments, (ids) =>
        fastify.prisma.attachment.findMany({
          where: { id: { in: ids } },
          select: { id: true, userId: true },
        }),
      ),
      crossUserIds(body.settings, (ids) =>
        fastify.prisma.setting.findMany({
          where: { id: { in: ids } },
          select: { id: true, userId: true },
        }),
      ),
    ]);

    const response: ConflictResponse = {
      folders,
      notes,
      diagrams,
      attachments,
      settings,
    };
    return response;
  });
}
