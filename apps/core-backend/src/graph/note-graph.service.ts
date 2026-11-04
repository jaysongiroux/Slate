import pino from "pino";
import type { PrismaClient } from "@slate/server-db";
import { NOTE_GRAPH_ENABLED_SETTING_KEY } from "@slate/shared";
import { normalizeIdForUser } from "../replication/notes.replication";
import type { JobsService } from "../jobs/jobs.service";

const logger = pino({ name: "NoteGraphService" });

const NOTE_GRAPH_TOP_K = 6;
const NOTE_GRAPH_MIN_SCORE = 0.45;
const NOTE_GRAPH_LOCAL_PERCENTILE = 0.7;
// A busy hub may not reciprocate its specialist's best match. Require a
// strong score and clear separation from the runner-up, or a near-duplicate.
const NOTE_GRAPH_STANDOUT_SCORE = 0.6;
const NOTE_GRAPH_STANDOUT_GAP = 0.08;
const NOTE_GRAPH_NEAR_DUPLICATE = 0.95;
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
   * Full delete + rebuild from embedded passages (worker body).
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

    try {
      // Compare each cross-note chunk pair once. Aggregate before ranking so
      // repeated passages in a long note consume just one neighbor slot.
      await this.prisma.$transaction([
        this.prisma.documentSimilarityEdge.deleteMany({ where: { userId } }),
        this.prisma.$executeRaw`
          INSERT INTO "document_similarity_edge" ("id", "userId", "fromDocumentId", "toDocumentId", "score", "createdAt")
          WITH chunks AS (
            SELECT c."documentId" AS doc, c.embedding, c."embeddingModel" AS model
            FROM document_chunk c
            JOIN document d ON d.id = c."documentId"
            WHERE d."userId" = ${userId} AND c."userId" = ${userId}
              AND NOT d.deleted AND d.embedded AND c.embedding IS NOT NULL
              AND btrim(c.content) <> ''
          ),
          pairs AS (
            SELECT a.doc AS lo, b.doc AS hi, 1 - MIN(a.embedding <=> b.embedding) AS score
            FROM chunks a
            JOIN chunks b ON a.doc < b.doc AND a.model = b.model
            GROUP BY a.doc, b.doc
          ),
          neighbors AS (
            SELECT lo AS doc, hi AS neighbor, score FROM pairs WHERE score <= 1
            UNION ALL
            SELECT hi, lo, score FROM pairs WHERE score <= 1
          ),
          ranked AS (
            SELECT *,
              ROW_NUMBER() OVER by_strength AS rank,
              LEAD(score) OVER by_strength AS runner_up,
              CUME_DIST() OVER (PARTITION BY doc ORDER BY score) AS local_percentile
            FROM neighbors
            WINDOW by_strength AS (PARTITION BY doc ORDER BY score DESC, neighbor)
          )
          SELECT gen_random_uuid()::text, ${userId}, LEAST(doc, neighbor),
                 GREATEST(doc, neighbor), MAX(score), NOW()
          FROM ranked
          WHERE rank <= ${NOTE_GRAPH_TOP_K} AND score >= ${NOTE_GRAPH_MIN_SCORE}
          GROUP BY LEAST(doc, neighbor), GREATEST(doc, neighbor)
          HAVING (COUNT(*) = 2 AND MAX(local_percentile) >= ${NOTE_GRAPH_LOCAL_PERCENTILE})
              OR BOOL_OR(rank = 1 AND score >= ${NOTE_GRAPH_STANDOUT_SCORE}
                         AND (score >= ${NOTE_GRAPH_NEAR_DUPLICATE}
                              OR score - runner_up >= ${NOTE_GRAPH_STANDOUT_GAP}))
        `,
      ]);
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
      id: normalizeIdForUser(d.id, userId),
      title: d.title,
      preview: previewFromMarkdown(d.markdown ?? ""),
    }));
    const nodeIds = new Set(docs.map((d) => d.id));

    const edges = await this.prisma.documentSimilarityEdge.findMany({
      where: { userId },
      select: { fromDocumentId: true, toDocumentId: true, score: true },
      orderBy: [{ fromDocumentId: "asc" }, { toDocumentId: "asc" }],
    });

    // Guard against edges that reference a doc no longer in the node set
    // (e.g. deleted/un-embedded since the last rebuild) — a dangling edge
    // endpoint would otherwise create a phantom node in the renderer.
    const graphEdges: NoteGraphEdge[] = edges
      .filter((e) => nodeIds.has(e.fromDocumentId) && nodeIds.has(e.toDocumentId))
      .map((e) => ({
        source: normalizeIdForUser(e.fromDocumentId, userId),
        target: normalizeIdForUser(e.toDocumentId, userId),
        score: e.score,
      }));

    return { nodes, edges: graphEdges };
  }
}
