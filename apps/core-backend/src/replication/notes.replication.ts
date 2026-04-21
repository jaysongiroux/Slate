import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@slate/server-db";
import type { SseEventBus } from "./sse-event-bus";
import { detectConflict } from "./conflict";

// Resolve a (userId, path) collision by appending -1, -2, ... to the preferred
// path until a free slot is found. Caller passes excludeId for updates so the
// row isn't considered in conflict with itself.
async function resolveUniquePath(
  prisma: PrismaClient,
  userId: string,
  preferredPath: string,
  excludeId?: string,
): Promise<string> {
  let candidate = preferredPath;
  for (let suffix = 1; suffix <= 100; suffix++) {
    const existing = await prisma.document.findFirst({
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
  // Extremely unlikely fallback: append a short random suffix.
  return `${preferredPath}-${Math.random().toString(36).slice(2, 8)}`;
}

interface Checkpoint {
  id: string;
  updatedAt: string;
}

interface NoteDoc {
  id: string;
  title: string;
  path: string;
  content: unknown;
  markdown: string;
  pinned: boolean;
  isDeleted: boolean;
  isTemplate: boolean;
  updatedAt: string;
  createdAt: string;
  _deleted?: boolean;
}

function toNoteDoc(row: {
  id: string;
  title: string;
  path: string;
  content: unknown;
  markdown: string;
  pinned: boolean;
  deleted: boolean;
  isTemplate: boolean;
  updatedAt: Date;
  createdAt: Date;
}): NoteDoc {
  return {
    id: row.id,
    title: row.title,
    path: row.path,
    content: row.content,
    markdown: row.markdown,
    pinned: row.pinned,
    isDeleted: row.deleted,
    isTemplate: row.isTemplate,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function registerNotesReplication(fastify: FastifyInstance, eventBus: SseEventBus) {
  const auth = { preHandler: [fastify.authenticate] };

  // --- PULL ---
  fastify.post("/api/replication/notes/pull", auth, async (request) => {
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

    const rows = await fastify.prisma.document.findMany({
      where,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: batchSize,
      select: {
        id: true,
        title: true,
        path: true,
        content: true,
        markdown: true,
        pinned: true,
        deleted: true,
        isTemplate: true,
        updatedAt: true,
        createdAt: true,
      },
    });

    const documents = rows.map(toNoteDoc);
    const newCheckpoint =
      documents.length > 0
        ? {
            id: documents[documents.length - 1].id,
            updatedAt: documents[documents.length - 1].updatedAt,
          }
        : checkpoint;

    return { documents, checkpoint: newCheckpoint };
  });

  // --- PUSH ---
  fastify.post("/api/replication/notes/push", auth, async (request) => {
    const { changeRows } = request.body as {
      changeRows: Array<{
        assumedMasterState: NoteDoc | null;
        newDocumentState: NoteDoc;
      }>;
    };
    const userId = request.user!.userId;
    const conflicts: NoteDoc[] = [];

    for (const row of changeRows) {
      const { assumedMasterState, newDocumentState } = row;

      try {
        const currentMaster = await fastify.prisma.document.findFirst({
          where: { id: newDocumentState.id, userId },
          select: {
            id: true,
            title: true,
            path: true,
            content: true,
            markdown: true,
            pinned: true,
            deleted: true,
            isTemplate: true,
            updatedAt: true,
            createdAt: true,
          },
        });

        const masterDoc = currentMaster ? toNoteDoc(currentMaster) : null;
        const conflict = detectConflict(masterDoc, assumedMasterState);

        if (conflict) {
          conflicts.push(conflict);
          continue;
        }

        // RxDB hard-delete signal: the client has removed this row locally
        // (see createNote's ghost.remove in note-operations.ts). Tombstone the
        // row so the (userId, path) slot is freed while keeping a pullable
        // record with deleted=true so other devices still receive the
        // deletion. Content, markdown, chunks, and similarity edges are
        // cleared since they're regeneratable or no longer meaningful.
        // Attachments are preserved and swept by a separate GC job because
        // the same attachment id can be referenced by other notes' content
        // via upload deduplication.
        if (newDocumentState._deleted) {
          if (currentMaster) {
            await fastify.prisma.$transaction([
              fastify.prisma.documentChunk.deleteMany({
                where: { documentId: newDocumentState.id },
              }),
              fastify.prisma.documentSimilarityEdge.deleteMany({
                where: {
                  OR: [
                    { fromDocumentId: newDocumentState.id },
                    { toDocumentId: newDocumentState.id },
                  ],
                },
              }),
              fastify.prisma.document.update({
                where: { id: newDocumentState.id },
                data: {
                  deleted: true,
                  path: `__deleted__/${newDocumentState.id}`,
                  content: {},
                  markdown: "",
                  embedded: false,
                },
              }),
            ]);
          }

          eventBus.publish({
            collection: "notes",
            userId,
            documentId: newDocumentState.id,
            operation: "DELETE",
          });
          continue;
        }

        // Auto-resolve (userId, path) collisions caused by concurrent creates
        // or renames from other devices. The renamed doc flows back via SSE/
        // pull and RxDB updates the client copy.
        const resolvedPath = await resolveUniquePath(
          fastify.prisma,
          userId,
          newDocumentState.path,
          currentMaster ? newDocumentState.id : undefined,
        );
        if (resolvedPath !== newDocumentState.path) {
          request.log.info(
            {
              documentId: newDocumentState.id,
              requestedPath: newDocumentState.path,
              resolvedPath,
              userId,
            },
            "Auto-resolved note path collision",
          );
        }

        if (currentMaster) {
          await fastify.prisma.document.update({
            where: { id: newDocumentState.id },
            data: {
              title: newDocumentState.title,
              path: resolvedPath,
              content: newDocumentState.content as any,
              markdown: newDocumentState.markdown,
              pinned: newDocumentState.pinned,
              deleted: newDocumentState.isDeleted,
              isTemplate: newDocumentState.isTemplate,
              embedded: false,
            },
          });
        } else {
          await fastify.prisma.document.create({
            data: {
              id: newDocumentState.id,
              userId,
              title: newDocumentState.title,
              path: resolvedPath,
              content: newDocumentState.content as any,
              markdown: newDocumentState.markdown ?? "",
              pinned: newDocumentState.pinned,
              deleted: newDocumentState.isDeleted,
              isTemplate: newDocumentState.isTemplate,
            },
          });
        }

        eventBus.publish({
          collection: "notes",
          userId,
          documentId: newDocumentState.id,
          operation: currentMaster ? "UPDATE" : "INSERT",
        });

        // Enqueue materialization job
        if (fastify.jobsService) {
          await fastify.jobsService.enqueue("materialize", {
            documentId: newDocumentState.id,
            userId,
          });
        }
      } catch (err) {
        request.log.error(
          { collection: "notes", documentId: newDocumentState.id, userId, err },
          "Replication push failed for document",
        );
        throw err;
      }
    }

    return { conflicts };
  });

  // --- STREAM (SSE) ---
  // Use authenticateAttachment (accepts ?token= query param) because EventSource can't set headers
  const streamAuth = { preHandler: [fastify.authenticateAttachment] };
  fastify.get("/api/replication/notes/stream", streamAuth, async (request, reply) => {
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

    const unsubscribe = eventBus.subscribe("notes", userId, async (event) => {
      const doc = await fastify.prisma.document.findFirst({
        where: { id: event.documentId, userId },
        select: {
          id: true,
          title: true,
          path: true,
          content: true,
          markdown: true,
          pinned: true,
          deleted: true,
          isTemplate: true,
          updatedAt: true,
          createdAt: true,
        },
      });

      if (doc) {
        const data = JSON.stringify({
          documents: [toNoteDoc(doc)],
          checkpoint: {
            id: doc.id,
            updatedAt: doc.updatedAt.toISOString(),
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
