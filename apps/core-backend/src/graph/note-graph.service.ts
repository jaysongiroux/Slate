import pino from "pino";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@slate/server-db";
import { NOTE_GRAPH_ENABLED_SETTING_KEY } from "@slate/shared";
import { EMBEDDING_VECTOR_DIMENSIONS } from "../ai/embedding-dimensions";
import type { JobsService } from "../jobs/jobs.service";

const logger = pino({ name: "NoteGraphService" });

const NOTE_GRAPH_TOP_K = 10;
const NOTE_GRAPH_QUEUE = "note-graph-rebuild";

export interface NoteGraphNode {
  id: string;
  title: string;
  preview: string;
}

export interface NoteGraphEdge {
  source: string;
  target: string;
  score: number;
}

export interface NoteGraphPayload {
  nodes: NoteGraphNode[];
  edges: NoteGraphEdge[];
}

function previewFromMarkdown(markdown: string): string {
  const lines = markdown
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const picked = lines.slice(0, 2).join(" ");
  if (picked.length <= 240) return picked;
  return `${picked.slice(0, 237)}…`;
}

export class NoteGraphService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly jobs: JobsService,
  ) {}

  async isNoteGraphEnabled(userId: string): Promise<boolean> {
    const row = await this.prisma.setting.findFirst({
      where: { userId, key: NOTE_GRAPH_ENABLED_SETTING_KEY },
      select: { value: true },
    });
    if (!row?.value) return false;
    if (typeof row.value === "boolean") return row.value;
    if (typeof row.value === "object" && row.value !== null && "enabled" in row.value) {
      return Boolean((row.value as { enabled?: boolean }).enabled);
    }
    return false;
  }

  async hasEmbeddingConfigured(userId: string): Promise<boolean> {
    const cfg = await this.prisma.aiConfig.findUnique({
      where: { userId },
      select: { embeddingModel: true, embeddingProvider: true },
    });
    return Boolean(cfg?.embeddingModel && cfg?.embeddingProvider);
  }

  async embedRemainingForUser(userId: string): Promise<number> {
    const total = await this.prisma.document.count({
      where: { userId, deleted: false },
    });
    const embedded = await this.prisma.document.count({
      where: { userId, deleted: false, embedded: true },
    });
    return Math.max(0, total - embedded);
  }

  async deleteAllEdgesForUser(userId: string): Promise<void> {
    await this.prisma.documentSimilarityEdge.deleteMany({ where: { userId } });
  }

  /**
   * Enqueue a full rebuild when the extension is on, embeddings are configured,
   * and every non-deleted document is embedded.
   */
  async enqueueRebuildIfEligible(userId: string): Promise<void> {
    const enabled = await this.isNoteGraphEnabled(userId);
    if (!enabled) return;
    const configured = await this.hasEmbeddingConfigured(userId);
    if (!configured) return;
    const remaining = await this.embedRemainingForUser(userId);
    if (remaining > 0) return;
    try {
      await this.jobs.enqueue(NOTE_GRAPH_QUEUE, { userId });
      logger.info({ userId }, "note-graph-rebuild enqueued");
    } catch (error) {
      logger.error(`Failed to enqueue ${NOTE_GRAPH_QUEUE} for ${userId}: ${error}`);
    }
  }

  /**
   * Full delete + rebuild from chunk centroids (worker body).
   * Pass `force: true` for user-initiated rebuilds — the worker should still
   * gate background runs on the enabled setting, but explicit requests bypass
   * it (the server-side setting can lag the desktop UI's state).
   */
  async rebuildGraphForUser(userId: string, options?: { force?: boolean }): Promise<void> {
    if (!options?.force) {
      const enabled = await this.isNoteGraphEnabled(userId);
      if (!enabled) {
        await this.deleteAllEdgesForUser(userId);
        return;
      }
    }
    const configured = await this.hasEmbeddingConfigured(userId);
    if (!configured) {
      await this.deleteAllEdgesForUser(userId);
      return;
    }

    await this.deleteAllEdgesForUser(userId);

    const dim = EMBEDDING_VECTOR_DIMENSIONS;
    const k = NOTE_GRAPH_TOP_K;

    try {
      await this.prisma.$executeRaw`
        INSERT INTO "document_similarity_edge" ("id", "userId", "fromDocumentId", "toDocumentId", "score", "createdAt")
        WITH centroids AS (
          SELECT d.id AS doc_id, avg(dc.embedding)::vector(${Prisma.raw(String(dim))}) AS vec
          FROM "document" d
          INNER JOIN "document_chunk" dc ON dc."documentId" = d.id
          WHERE d."userId" = ${userId}
            AND d.deleted = false
            AND d.embedded = true
            AND dc.embedding IS NOT NULL
          GROUP BY d.id
        ),
        directed AS (
          SELECT
            c1.doc_id AS a_id,
            c2.doc_id AS b_id,
            (1.0::double precision - (c1.vec <=> c2.vec)::double precision) AS score
          FROM centroids c1
          CROSS JOIN LATERAL (
            SELECT c.doc_id, c.vec
            FROM centroids c
            WHERE c.doc_id <> c1.doc_id
            ORDER BY c1.vec <=> c.vec
            LIMIT ${k}
          ) AS c2
        )
        SELECT
          gen_random_uuid()::text,
          ${userId},
          LEAST(a_id, b_id)::text,
          GREATEST(a_id, b_id)::text,
          MAX(score)::double precision,
          NOW()
        FROM directed
        GROUP BY LEAST(a_id, b_id), GREATEST(a_id, b_id)
      `;
    } catch (error) {
      logger.error(`rebuildGraphForUser failed for ${userId}: ${error}`);
      throw error;
    }
  }

  async getGraphPayload(userId: string): Promise<NoteGraphPayload | null> {
    if (!(await this.isNoteGraphEnabled(userId))) {
      return null;
    }

    const edges = await this.prisma.documentSimilarityEdge.findMany({
      where: { userId },
      select: { fromDocumentId: true, toDocumentId: true, score: true },
    });
    if (edges.length === 0) {
      return { nodes: [], edges: [] };
    }

    const ids = new Set<string>();
    for (const e of edges) {
      ids.add(e.fromDocumentId);
      ids.add(e.toDocumentId);
    }

    const docs = await this.prisma.document.findMany({
      where: { userId, deleted: false, id: { in: [...ids] } },
      select: { id: true, title: true, markdown: true },
    });

    const nodes: NoteGraphNode[] = docs.map((d) => ({
      id: d.id,
      title: d.title,
      preview: previewFromMarkdown(d.markdown ?? ""),
    }));

    const graphEdges: NoteGraphEdge[] = edges.map((e) => ({
      source: e.fromDocumentId,
      target: e.toDocumentId,
      score: e.score,
    }));

    return { nodes, edges: graphEdges };
  }
}
