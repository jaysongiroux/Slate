import { LINKWARDEN_TOKENS_SETTING_KEY } from "@slate/shared";
import type { FastifyInstance } from "fastify";
import type { SseEventBus } from "./sse-event-bus";
import { detectConflict } from "./conflict";

interface Checkpoint {
  id: string;
  updatedAt: string;
}

interface SettingDoc {
  id: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

function toSettingDoc(row: {
  id: string;
  key: string;
  value: unknown;
  updatedAt: Date;
}): SettingDoc {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function registerSettingsReplication(fastify: FastifyInstance, eventBus: SseEventBus) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.post("/api/replication/settings/pull", auth, async (request) => {
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

    const rows = await fastify.prisma.setting.findMany({
      where,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: batchSize,
    });

    const documents = rows
      .filter((row) => row.key !== LINKWARDEN_TOKENS_SETTING_KEY)
      .map(toSettingDoc);
    const newCheckpoint =
      documents.length > 0
        ? {
            id: documents[documents.length - 1].id,
            updatedAt: documents[documents.length - 1].updatedAt,
          }
        : checkpoint;

    return { documents, checkpoint: newCheckpoint };
  });

  fastify.post("/api/replication/settings/push", auth, async (request) => {
    const { changeRows } = request.body as {
      changeRows: Array<{
        assumedMasterState: SettingDoc | null;
        newDocumentState: SettingDoc;
      }>;
    };
    const userId = request.user!.userId;
    const conflicts: SettingDoc[] = [];

    for (const row of changeRows) {
      const { assumedMasterState, newDocumentState } = row;

      try {
        const currentMaster = await fastify.prisma.setting.findFirst({
          where: { id: newDocumentState.id, userId },
        });

        const masterDoc = currentMaster ? toSettingDoc(currentMaster) : null;
        const conflict = detectConflict(masterDoc, assumedMasterState);

        if (conflict) {
          conflicts.push(conflict);
          continue;
        }

        if (currentMaster) {
          await fastify.prisma.setting.update({
            where: { id: newDocumentState.id },
            data: {
              key: newDocumentState.key,
              value: newDocumentState.value as any,
            },
          });
        } else {
          await fastify.prisma.setting.create({
            data: {
              id: newDocumentState.id,
              userId,
              key: newDocumentState.key,
              value: newDocumentState.value as any,
            },
          });
        }

        eventBus.publish({
          collection: "settings",
          userId,
          documentId: newDocumentState.id,
          operation: currentMaster ? "UPDATE" : "INSERT",
        });
      } catch (err) {
        request.log.error(
          { collection: "settings", documentId: newDocumentState.id, userId, err },
          "Replication push failed for document",
        );
        throw err;
      }
    }

    return { conflicts };
  });

  const streamAuth = { preHandler: [fastify.authenticateAttachment] };
  fastify.get("/api/replication/settings/stream", streamAuth, async (request, reply) => {
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

    const unsubscribe = eventBus.subscribe("settings", userId, async (event) => {
      const setting = await fastify.prisma.setting.findFirst({
        where: { id: event.documentId, userId },
      });

      if (setting && setting.key !== LINKWARDEN_TOKENS_SETTING_KEY) {
        const data = JSON.stringify({
          documents: [toSettingDoc(setting)],
          checkpoint: {
            id: setting.id,
            updatedAt: setting.updatedAt.toISOString(),
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
