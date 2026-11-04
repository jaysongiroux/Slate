import pino from "pino";
import type { PrismaClient } from "@slate/server-db";
import { MaterializeService } from "../materialization/materialize.service";
import { raw } from "@prisma/client/runtime/library";
import { ModelProviderService } from "./model-provider.service";
import { ChunkingService } from "./chunking.service";
import { EMBEDDING_VECTOR_DIMENSIONS, padEmbeddingToMax } from "./embedding-dimensions";

export class EmbeddingService {
  private readonly logger = pino({ name: "EmbeddingService" });

  constructor(
    private readonly prisma: PrismaClient,
    private readonly modelProvider: ModelProviderService,
    private readonly chunking: ChunkingService,
    private readonly materialize = new MaterializeService(),
  ) {}

  async embedDocument(
    doc: {
      id: string;
      userId: string;
      markdown: string;
      title: string;
      content?: unknown;
      updatedAt?: Date;
    },
    embeddingModel: string,
  ): Promise<void> {
    const recovered = doc.markdown.trim() ? null : this.materialize.toMarkdown(doc.content);
    const body = recovered?.trim() || doc.markdown.trim() || doc.title.trim();
    const chunks = body ? this.chunking.chunkMarkdown(body) : [];
    // Generate embeddings for all chunk contents
    const texts = chunks.map((c) => c.content);
    const vectors = texts.length
      ? await (await this.modelProvider.getEmbeddingModel(doc.userId)).embedDocuments(texts)
      : [];
    if (vectors.length !== chunks.length) throw new Error("Incomplete document embeddings");

    // Insert each chunk with its vector using raw SQL (pgvector)
    const inserts = chunks.map((chunk, i) => {
      const vector = vectors[i];
      const padded = padEmbeddingToMax(vector);
      const id = crypto.randomUUID();
      const vectorStr = `[${padded.join(",")}]`;

      return this.prisma.$executeRaw`
        INSERT INTO document_chunk (id, "documentId", "userId", "chunkIndex", content, heading, embedding, "embeddingModel", "createdAt")
        VALUES (${id}, ${doc.id}, ${doc.userId}, ${chunk.chunkIndex}, ${chunk.content}, ${chunk.heading}, ${vectorStr}::vector(${raw(String(EMBEDDING_VECTOR_DIMENSIONS))}), ${embeddingModel}, NOW())
      `;
    });

    // Lock the same document revision before replacing chunks. A concurrent
    // edit or failed insert rolls the whole replacement back.
    await this.prisma.$transaction([
      this.prisma.document.update({
        where: { id: doc.id, ...(doc.updatedAt && { updatedAt: doc.updatedAt }) },
        data: { embedded: true, ...(recovered && { markdown: recovered }) },
      }),
      this.prisma.documentChunk.deleteMany({ where: { documentId: doc.id } }),
      ...inserts,
    ]);

    this.logger.info(
      `Embedded document ${doc.id} (${doc.title}): ${chunks.length} chunk(s) stored with model ${embeddingModel}`,
    );
  }

  async repairGraphInputs(userId: string): Promise<void> {
    const config = await this.prisma.aiConfig.findUnique({
      where: { userId },
      select: { embeddingProvider: true, embeddingModel: true },
    });
    if (!config?.embeddingModel || !config.embeddingProvider) return;

    // Existing installations can have empty chunks marked as fully embedded.
    // Read a page at a time because rich-text bodies can be large.
    let after = "";
    while (true) {
      const docs = await this.prisma.document.findMany({
        where: {
          userId,
          deleted: false,
          id: { gt: after },
          OR: [
            { embedded: false },
            { chunks: { some: { content: "" } } },
            { chunks: { none: {} }, title: { not: "" } },
          ],
        },
        orderBy: { id: "asc" },
        take: 50,
        select: {
          id: true,
          userId: true,
          markdown: true,
          title: true,
          content: true,
          updatedAt: true,
        },
      });
      for (const doc of docs) await this.embedDocument(doc, config.embeddingModel);
      if (docs.length < 50) break;
      after = docs[docs.length - 1].id;
    }
  }

  /**
   * @param batchSize  Max documents to process in this batch.
   * @param cooldownMinutes  If set, only process documents whose updatedAt is
   *                         older than this many minutes ago (debounce rapid edits).
   * @returns How many documents were pulled from the queue for this batch (attempted),
   *          not necessarily all embedded successfully.
   */
  async processUnembeddedDocuments(batchSize = 50, cooldownMinutes?: number): Promise<number> {
    // Find users who have an AiConfig with embedding configured
    const configs = await this.prisma.aiConfig.findMany({
      where: {
        embeddingModel: { not: null },
        embeddingProvider: { not: null },
      },
      select: { userId: true, embeddingModel: true },
    });

    if (configs.length === 0) {
      this.logger.info("No users with embedding configured, skipping batch");
      return 0;
    }

    const userIds = configs.map((c: { userId: string; embeddingModel: string | null }) => c.userId);

    // Find unembedded documents for those users
    const where: Record<string, unknown> = {
      userId: { in: userIds },
      embedded: false,
      deleted: false,
    };
    if (cooldownMinutes) {
      where.updatedAt = { lt: new Date(Date.now() - cooldownMinutes * 60 * 1000) };
    }

    const documents = await this.prisma.document.findMany({
      where,
      select: {
        id: true,
        userId: true,
        markdown: true,
        title: true,
        content: true,
        updatedAt: true,
      },
      take: batchSize,
    });

    if (documents.length === 0) {
      return 0;
    }

    this.logger.info(
      `Processing ${documents.length} unembedded document(s) for ${configs.length} configured user(s)`,
    );

    for (const doc of documents) {
      const config = configs.find(
        (c: { userId: string; embeddingModel: string | null }) => c.userId === doc.userId,
      );
      const embeddingModel = config?.embeddingModel;

      if (!embeddingModel) {
        continue;
      }

      try {
        await this.embedDocument(doc, embeddingModel);
      } catch (error) {
        this.logger.error(`Failed to embed document ${doc.id} for user ${doc.userId}: ${error}`);
      }
    }

    this.logger.info(`Batch complete: processed ${documents.length} document(s)`);
    return documents.length;
  }
}
