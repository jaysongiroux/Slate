import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@slate/server-db";
import type { SseEventBus } from "./sse-event-bus";
import { detectConflict } from "./conflict";

async function resolveUniqueFolderPath(
  prisma: PrismaClient,
  userId: string,
  preferredPath: string,
  excludeId?: string,
): Promise<string> {
  let candidate = preferredPath;
  for (let suffix = 1; suffix <= 100; suffix++) {
    const existing = await prisma.folder.findFirst({
      where: {
        userId,
        path: candidate,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${preferredPath}-${suffix}`;
  }
  return `${preferredPath}-${Math.random().toString(36).slice(2, 8)}`;
}

interface Checkpoint {
  id: string;
  updatedAt: string;
}

interface FolderDoc {
  id: string;
  path: string;
  updatedAt: string;
  createdAt: string;
  _deleted?: boolean;
}

function toFolderDoc(row: {
  id: string;
  path: string;
  updatedAt: Date;
  createdAt: Date;
}): FolderDoc {
  return {
    id: row.id,
    path: row.path,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function registerFoldersReplication(fastify: FastifyInstance, eventBus: SseEventBus) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.post("/api/replication/folders/pull", auth, async (request) => {
    const { checkpoint, limit } = request.body as {
      checkpoint: Checkpoint | null;
      limit: number;
    };
    const userId = request.user!.userId;
    const batchSize = Math.min(limit || 100, 200);

    const where: Record<string, unknown> = { userId };
    if (checkpoint) {
      where.OR = [
        { updatedAt: { gt: new Date(checkpoint.updatedAt) } },
        {
          updatedAt: new Date(checkpoint.updatedAt),
          id: { gt: checkpoint.id },
        },
      ];
    }

    const rows = await fastify.prisma.folder.findMany({
      where,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: batchSize,
    });

    const documents = rows.map(toFolderDoc);
    const newCheckpoint =
      documents.length > 0
        ? {
            id: documents[documents.length - 1].id,
            updatedAt: documents[documents.length - 1].updatedAt,
          }
        : checkpoint;

    return { documents, checkpoint: newCheckpoint };
  });

  fastify.post("/api/replication/folders/push", auth, async (request) => {
    const { changeRows } = request.body as {
      changeRows: Array<{
        assumedMasterState: FolderDoc | null;
        newDocumentState: FolderDoc;
      }>;
    };
    const userId = request.user!.userId;
    const conflicts: FolderDoc[] = [];

    for (const row of changeRows) {
      const { assumedMasterState, newDocumentState } = row;

      try {
        const currentMaster = await fastify.prisma.folder.findFirst({
          where: { id: newDocumentState.id, userId },
        });

        const masterDoc = currentMaster ? toFolderDoc(currentMaster) : null;
        const conflict = detectConflict(masterDoc, assumedMasterState);

        if (conflict) {
          conflicts.push(conflict);
          continue;
        }

        if (newDocumentState._deleted) {
          if (currentMaster) {
            await fastify.prisma.folder.delete({
              where: { id: newDocumentState.id },
            });
          }

          eventBus.publish({
            collection: "folders",
            userId,
            documentId: newDocumentState.id,
            operation: "DELETE",
          });
          continue;
        }

        if (currentMaster) {
          await fastify.prisma.folder.update({
            where: { id: newDocumentState.id },
            data: { path: newDocumentState.path },
          });
        } else {
          await fastify.prisma.folder.create({
            data: {
              id: newDocumentState.id,
              userId,
              path: newDocumentState.path,
            },
          });
        }

        eventBus.publish({
          collection: "folders",
          userId,
          documentId: newDocumentState.id,
          operation: currentMaster ? "UPDATE" : "INSERT",
        });
      } catch (err) {
        request.log.error(
          { collection: "folders", documentId: newDocumentState.id, userId, err },
          "Replication push failed for document",
        );
        throw err;
      }
    }

    return { conflicts };
  });

  fastify.post("/api/replication/folders/bulk-import", auth, async (request, reply) => {
    const { documents } = request.body as { documents: FolderDoc[] };
    if (!Array.isArray(documents)) {
      reply.code(400);
      return { error: "documents must be an array" };
    }
    if (documents.length > 200) {
      reply.code(400);
      return { error: "documents per request must be <= 200" };
    }

    const userId = request.user!.userId;
    let imported = 0;
    let skipped = 0;

    for (const doc of documents) {
      const incumbent = await fastify.prisma.folder.findUnique({ where: { id: doc.id } });
      if (incumbent && incumbent.userId !== userId) {
        skipped++;
        continue;
      }

      const resolvedPath = await resolveUniqueFolderPath(
        fastify.prisma,
        userId,
        doc.path,
        incumbent ? doc.id : undefined,
      );

      if (incumbent) {
        await fastify.prisma.folder.update({
          where: { id: doc.id },
          data: { path: resolvedPath },
        });
      } else {
        await fastify.prisma.folder.create({
          data: { id: doc.id, userId, path: resolvedPath },
        });
      }
      imported++;
    }

    return { imported, skipped };
  });

  const streamAuth = { preHandler: [fastify.authenticateAttachment] };
  fastify.get("/api/replication/folders/stream", streamAuth, async (request, reply) => {
    const userId = request.userSession!.userId;

    const origin = request.headers.origin || "*";
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    });

    reply.raw.write(":\n\n");

    const heartbeat = setInterval(() => {
      reply.raw.write(":\n\n");
    }, 30000);

    const unsubscribe = eventBus.subscribe("folders", userId, async (event) => {
      const folder = await fastify.prisma.folder.findFirst({
        where: { id: event.documentId, userId },
      });

      if (folder) {
        const data = JSON.stringify({
          documents: [toFolderDoc(folder)],
          checkpoint: {
            id: folder.id,
            updatedAt: folder.updatedAt.toISOString(),
          },
        });
        reply.raw.write(`data: ${data}\n\n`);
      }
    });

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
