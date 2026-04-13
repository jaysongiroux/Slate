import type { FastifyInstance } from "fastify";
import type { SseEventBus } from "./sse-event-bus";
import { detectConflict } from "./conflict";

interface Checkpoint {
  id: string;
  updatedAt: string;
}

interface NoteDoc {
  id: string;
  title: string;
  path: string;
  content: unknown;
  pinned: boolean;
  deleted: boolean;
  isTemplate: boolean;
  updatedAt: string;
  createdAt: string;
}

function toNoteDoc(row: {
  id: string;
  title: string;
  path: string;
  content: unknown;
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
    pinned: row.pinned,
    deleted: row.deleted,
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

      const currentMaster = await fastify.prisma.document.findFirst({
        where: { id: newDocumentState.id, userId },
        select: {
          id: true,
          title: true,
          path: true,
          content: true,
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

      if (currentMaster) {
        await fastify.prisma.document.update({
          where: { id: newDocumentState.id },
          data: {
            title: newDocumentState.title,
            path: newDocumentState.path,
            content: newDocumentState.content as any,
            pinned: newDocumentState.pinned,
            deleted: newDocumentState.deleted,
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
            path: newDocumentState.path,
            content: newDocumentState.content as any,
            markdown: "",
            pinned: newDocumentState.pinned,
            deleted: newDocumentState.deleted,
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
