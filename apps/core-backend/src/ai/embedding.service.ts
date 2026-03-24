import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ModelProviderService } from "./model-provider.service";
import { ChunkingService } from "./chunking.service";

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modelProvider: ModelProviderService,
    private readonly chunking: ChunkingService,
  ) {}

  async embedDocument(
    doc: { id: string; userId: string; markdown: string; title: string },
    embeddingModel: string,
  ): Promise<void> {
    const chunks = this.chunking.chunkMarkdown(doc.markdown);

    // Delete existing chunks for this document
    await this.prisma.documentChunk.deleteMany({ where: { documentId: doc.id } });

    // Get the embedding model for this user
    const embedder = await this.modelProvider.getEmbeddingModel(doc.userId);

    // Generate embeddings for all chunk contents
    const texts = chunks.map((c) => c.content);
    const vectors = await embedder.embedDocuments(texts);

    // Insert each chunk with its vector using raw SQL (pgvector)
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vector = vectors[i];
      const id = crypto.randomUUID();
      const vectorStr = `[${vector.join(",")}]`;

      await this.prisma.$executeRaw`
        INSERT INTO document_chunk (id, "documentId", "userId", "chunkIndex", content, heading, embedding, "embeddingModel", "createdAt")
        VALUES (${id}, ${doc.id}, ${doc.userId}, ${chunk.chunkIndex}, ${chunk.content}, ${chunk.heading}, ${vectorStr}::vector, ${embeddingModel}, NOW())
      `;
    }

    // Mark document as embedded
    await this.prisma.document.update({
      where: { id: doc.id },
      data: { embedded: true },
    });

    this.logger.log(
      `Embedded document ${doc.id} (${doc.title}): ${chunks.length} chunk(s) stored with model ${embeddingModel}`,
    );
  }

  async processUnembeddedDocuments(batchSize = 50): Promise<void> {
    // Find users who have an AiConfig with embedding configured
    const configs = await this.prisma.aiConfig.findMany({
      where: {
        embeddingModel: { not: null },
        embeddingProvider: { not: null },
      },
      select: { userId: true, embeddingModel: true },
    });

    if (configs.length === 0) {
      this.logger.log("No users with embedding configured, skipping batch");
      return;
    }

    const userIds = configs.map((c: { userId: string; embeddingModel: string | null }) => c.userId);

    // Find unembedded documents for those users
    const documents = await this.prisma.document.findMany({
      where: {
        userId: { in: userIds },
        embedded: false,
        deleted: false,
      },
      select: { id: true, userId: true, markdown: true, title: true },
      take: batchSize,
    });

    this.logger.log(
      `Processing ${documents.length} unembedded document(s) for ${configs.length} configured user(s)`,
    );

    for (const doc of documents) {
      const config = configs.find((c: { userId: string; embeddingModel: string | null }) => c.userId === doc.userId);
      const embeddingModel = config?.embeddingModel;

      if (!embeddingModel) {
        continue;
      }

      try {
        await this.embedDocument(doc, embeddingModel);
      } catch (error) {
        this.logger.error(
          `Failed to embed document ${doc.id} for user ${doc.userId}: ${error}`,
        );
      }
    }

    this.logger.log(`Batch complete: processed ${documents.length} document(s)`);
  }
}
