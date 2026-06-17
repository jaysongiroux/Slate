import pino from "pino";
import type { PrismaClient } from "@slate/server-db";
import { NOTE_GRAPH_ENABLED_SETTING_KEY } from "@slate/shared";
import type { JobsService } from "../jobs/jobs.service";

const logger = pino({ name: "NoteGraphService" });

// Per-document mutual-KNN fanout: each note keeps an edge only to partners
// that also rank it within their top-K. Sparsifies the graph to reciprocal
// relationships.
const NOTE_GRAPH_TOP_K = 6;
// Per-chunk fanout for the chunk-level nearest-neighbor search. A note's
// relatedness to another is the single best-matching chunk pair, so we only
// need each chunk's closest few cross-document chunks.
const NOTE_GRAPH_CHUNK_K = 5;
// Absolute cosine-similarity floor — a hard safety net so junk edges never
// survive even when a corpus's whole distribution is low.
const NOTE_GRAPH_MIN_SCORE = 0.45;
// Adaptive floor: keep edges at/above this percentile of the corpus-wide
// candidate score distribution. Self-tunes to the embedding model and the
// user's writing (text embeddings cluster in a high, narrow, model-dependent
// band, so a fixed cutoff is brittle).
const NOTE_GRAPH_PERCENTILE = 0.7;
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

    const chunkK = NOTE_GRAPH_CHUNK_K;
    const docK = NOTE_GRAPH_TOP_K;
    const minScore = NOTE_GRAPH_MIN_SCORE;
    const percentile = NOTE_GRAPH_PERCENTILE;

    try {
      // Rebuild atomically: deleting then re-inserting inside one transaction
      // means a concurrent getGraphPayload never observes the empty window
      // between the delete and the insert.
      //
      // Relatedness is the single best-matching chunk pair between two notes
      // (chunk_pairs -> pair_scores MAX), aggregated up to a mutual document
      // KNN: an edge survives only when BOTH notes rank each other within their
      // top-K partners (HAVING count = 2). The surviving edges must also clear
      // an adaptive floor — the greater of an absolute safety floor and the
      // Nth percentile of the corpus-wide candidate distribution — so the cutoff
      // self-tunes to the embedding model and the user's writing.
      //
      // Scale note: the chunk-level CROSS JOIN LATERAL is exact KNN (no ANN
      // index), so cost grows ~O(chunks^2). Fine for a personal corpus in a
      // background job; add a pgvector hnsw index on document_chunk.embedding
      // before this runs over thousands of notes.
      await this.prisma.$transaction(async (tx) => {
        await tx.documentSimilarityEdge.deleteMany({ where: { userId } });
        await tx.$executeRaw`
          INSERT INTO "document_similarity_edge" ("id", "userId", "fromDocumentId", "toDocumentId", "score", "createdAt")
          WITH chunk_pairs AS (
            SELECT
              c1."documentId" AS a_doc,
              c2.doc_id AS b_doc,
              (1.0::double precision - (c1.embedding <=> c2.vec)::double precision) AS sim
            FROM "document_chunk" c1
            INNER JOIN "document" d1
              ON d1.id = c1."documentId"
             AND d1."userId" = ${userId}
             AND d1.deleted = false
             AND d1.embedded = true
            CROSS JOIN LATERAL (
              SELECT c."documentId" AS doc_id, c.embedding AS vec
              FROM "document_chunk" c
              INNER JOIN "document" d2
                ON d2.id = c."documentId"
               AND d2."userId" = ${userId}
               AND d2.deleted = false
               AND d2.embedded = true
              WHERE c."documentId" <> c1."documentId"
                AND c.embedding IS NOT NULL
              ORDER BY c1.embedding <=> c.embedding
              LIMIT ${chunkK}
            ) AS c2
            WHERE c1."userId" = ${userId}
              AND c1.embedding IS NOT NULL
          ),
          pair_scores AS (
            SELECT a_doc, b_doc, MAX(sim) AS score
            FROM chunk_pairs
            GROUP BY a_doc, b_doc
          ),
          ranked AS (
            SELECT
              a_doc,
              b_doc,
              score,
              row_number() OVER (PARTITION BY a_doc ORDER BY score DESC) AS rnk
            FROM pair_scores
          ),
          topk AS (
            SELECT a_doc, b_doc, score FROM ranked WHERE rnk <= ${docK}
          ),
          threshold AS (
            SELECT GREATEST(
                     ${minScore}::double precision,
                     COALESCE(
                       percentile_cont(${percentile}) WITHIN GROUP (ORDER BY score),
                       0
                     )
                   ) AS cutoff
            FROM pair_scores
          ),
          mutual AS (
            SELECT
              LEAST(a_doc, b_doc) AS lo,
              GREATEST(a_doc, b_doc) AS hi,
              MAX(score) AS score
            FROM topk
            GROUP BY LEAST(a_doc, b_doc), GREATEST(a_doc, b_doc)
            HAVING count(*) = 2
          )
          SELECT
            gen_random_uuid()::text,
            ${userId},
            m.lo,
            m.hi,
            m.score::double precision,
            NOW()
          FROM mutual m
          CROSS JOIN threshold t
          WHERE m.score >= t.cutoff
        `;
      });
    } catch (error) {
      logger.error(`rebuildGraphForUser failed for ${userId}: ${error}`);
      throw error;
    }
  }

  async getGraphPayload(userId: string): Promise<NoteGraphPayload | null> {
    if (!(await this.isNoteGraphEnabled(userId))) {
      return null;
    }

    // Nodes are every embedded note in the corpus — not just those that ended
    // up with an edge. Sparse/mutual edges mean many notes legitimately have no
    // strong neighbor; those still belong on the graph as standalone dots
    // rather than disappearing entirely.
    const docs = await this.prisma.document.findMany({
      where: { userId, deleted: false, embedded: true },
      select: { id: true, title: true, markdown: true },
    });
    if (docs.length === 0) {
      return { nodes: [], edges: [] };
    }

    const nodes: NoteGraphNode[] = docs.map((d) => ({
      id: d.id,
      title: d.title,
      preview: previewFromMarkdown(d.markdown ?? ""),
    }));
    const nodeIds = new Set(nodes.map((n) => n.id));

    const edges = await this.prisma.documentSimilarityEdge.findMany({
      where: { userId },
      select: { fromDocumentId: true, toDocumentId: true, score: true },
    });

    // Guard against edges that reference a doc no longer in the node set
    // (e.g. deleted/un-embedded since the last rebuild) — a dangling edge
    // endpoint would otherwise create a phantom node in the renderer.
    const graphEdges: NoteGraphEdge[] = edges
      .filter((e) => nodeIds.has(e.fromDocumentId) && nodeIds.has(e.toDocumentId))
      .map((e) => ({
        source: e.fromDocumentId,
        target: e.toDocumentId,
        score: e.score,
      }));

    return { nodes, edges: graphEdges };
  }
}
