import {
  LINKWARDEN_TOKENS_SETTING_KEY,
  isMigrationSkippedSettingKey,
} from "@slate/shared";
import { Prisma } from "@prisma/client";
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

function toSettingDoc(
  row: { id: string; key: string; value: unknown; updatedAt: Date },
  userId: string,
): SettingDoc {
  // The push handler salts ids with `::userId` on cross-user primary-key
  // collisions. Strip that suffix on the way out so the desktop's deterministic
  // id (e.g. `setting-extensions.noteGraphEnabled`) lines up with the local doc
  // and avoids duplicate replicated rows.
  const userSuffix = `::${userId}`;
  const id = row.id.endsWith(userSuffix) ? row.id.slice(0, -userSuffix.length) : row.id;
  return {
    id,
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

    const filteredRows = rows.filter((row) => row.key !== LINKWARDEN_TOKENS_SETTING_KEY);
    const documents = filteredRows.map((row) => toSettingDoc(row, userId));
    // Use the raw db id (possibly salted) for the checkpoint so subsequent
    // pulls' (updatedAt, id) tiebreaker hits the right row. Documents are
    // separately normalized via toSettingDoc.
    const newCheckpoint =
      filteredRows.length > 0
        ? {
            id: filteredRows[filteredRows.length - 1].id,
            updatedAt: filteredRows[filteredRows.length - 1].updatedAt.toISOString(),
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
        // Look up by (userId, key): the desktop's deterministic id (`setting-${key}`)
        // collides cross-user, so a (id, userId) match would miss and the create
        // below would 500 on P2002. The (userId, key) unique constraint is what
        // actually scopes a setting to a user.
        const currentMaster = await fastify.prisma.setting.findFirst({
          where: { userId, key: newDocumentState.key },
        });

        const masterDoc = currentMaster ? toSettingDoc(currentMaster, userId) : null;

        // RxDB sometimes pushes with a null/undefined assumedMasterState even
        // when a master already exists on the server (e.g., the client hasn't
        // yet pulled the server's confirmation of its own prior push). Settings
        // are single-writer per (userId, key), so fall back to last-write-wins
        // by updatedAt rather than treating this as a hard conflict, which
        // would otherwise cause the default conflict handler to revert the
        // client's local change.
        const effectiveAssumed =
          assumedMasterState == null && masterDoc != null
            ? new Date(newDocumentState.updatedAt) >= currentMaster!.updatedAt
              ? masterDoc
              : assumedMasterState
            : assumedMasterState;

        const conflict = detectConflict(masterDoc, effectiveAssumed);

        if (conflict) {
          conflicts.push(conflict);
          continue;
        }

        let storedId: string;
        if (currentMaster) {
          await fastify.prisma.setting.update({
            where: { id: currentMaster.id },
            data: {
              key: newDocumentState.key,
              value: newDocumentState.value as any,
            },
          });
          storedId = currentMaster.id;
        } else {
          storedId = newDocumentState.id;
          try {
            await fastify.prisma.setting.create({
              data: {
                id: storedId,
                userId,
                key: newDocumentState.key,
                value: newDocumentState.value as any,
              },
            });
          } catch (err) {
            // Cross-user primary-key collision: another user already owns a row
            // with this deterministic id. Salt with userId and retry so the
            // push still lands.
            if (
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === "P2002" &&
              Array.isArray(err.meta?.target) &&
              (err.meta?.target as string[]).includes("id")
            ) {
              storedId = `${newDocumentState.id}::${userId}`;
              await fastify.prisma.setting.create({
                data: {
                  id: storedId,
                  userId,
                  key: newDocumentState.key,
                  value: newDocumentState.value as any,
                },
              });
            } else {
              throw err;
            }
          }
        }

        eventBus.publish({
          collection: "settings",
          userId,
          documentId: storedId,
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

  fastify.post("/api/replication/settings/bulk-import", auth, async (request, reply) => {
    const { documents } = request.body as { documents: SettingDoc[] };
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
    let rejected = 0;
    let skipped = 0;

    for (const doc of documents) {
      if (isMigrationSkippedSettingKey(doc.key)) {
        rejected++;
        continue;
      }

      // Resolve against both unique constraints: (id) primary key and (userId, key).
      const byId = await fastify.prisma.setting.findUnique({ where: { id: doc.id } });
      if (byId && byId.userId !== userId) {
        // Cross-user id collision (rare). Skip rather than overwriting another user's row.
        skipped++;
        continue;
      }

      if (byId) {
        // Same id, same user — update key + value. Drop any (userId, key) row that
        // would otherwise collide on the unique constraint.
        if (byId.key !== doc.key) {
          const conflicting = await fastify.prisma.setting.findFirst({
            where: { userId, key: doc.key, NOT: { id: doc.id } },
            select: { id: true },
          });
          if (conflicting) {
            await fastify.prisma.setting.delete({ where: { id: conflicting.id } });
          }
        }
        await fastify.prisma.setting.update({
          where: { id: doc.id },
          data: { key: doc.key, value: doc.value as any },
        });
        imported++;
        continue;
      }

      // No row with this id. Check (userId, key) collision before creating.
      const byKey = await fastify.prisma.setting.findFirst({
        where: { userId, key: doc.key },
      });
      if (byKey) {
        // Existing key with a different id — overwrite the value, preserve the
        // incumbent id (avoids a P2002 on (userId, key)).
        await fastify.prisma.setting.update({
          where: { id: byKey.id },
          data: { value: doc.value as any },
        });
        imported++;
        continue;
      }

      await fastify.prisma.setting.create({
        data: { id: doc.id, userId, key: doc.key, value: doc.value as any },
      });
      imported++;
    }

    return { imported, rejected, skipped };
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
        const doc = toSettingDoc(setting, userId);
        const data = JSON.stringify({
          documents: [doc],
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
