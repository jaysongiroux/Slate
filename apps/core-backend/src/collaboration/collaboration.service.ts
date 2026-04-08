import { Injectable, Logger } from "@nestjs/common";
import { deriveDocumentTitle } from "@slate/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CrdtService } from "../documents/crdt.service";
import * as Y from "yjs";

@Injectable()
export class CollaborationService {
  private readonly logger = new Logger(CollaborationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crdtService: CrdtService,
  ) {}

  async handleLoadDocument(doc: Y.Doc, documentId: string, userId: string): Promise<void> {
    this.logger.log(`[load] looking up doc id=${documentId} userId=${userId}`);
    const record = await this.prisma.document.findFirst({
      where: { id: documentId, userId },
      select: { crdtState: true, markdown: true },
    });

    if (record?.crdtState) {
      this.logger.log(`[load] found existing crdtState (${record.crdtState.length} bytes)`);
      Y.applyUpdate(doc, new Uint8Array(record.crdtState));
    } else if (record?.markdown?.trim()) {
      this.logger.log(
        `[load] no crdtState, bootstrapping from markdown (${record.markdown.length} chars)`,
      );
      this.bootstrapFromMarkdown(doc, record.markdown);
      // Persist bootstrapped state so subsequent loads skip this path
      const crdtState = Buffer.from(Y.encodeStateAsUpdate(doc));
      await this.prisma.document.update({
        where: { id: documentId },
        data: { crdtState },
      });
    } else {
      this.logger.log(`[load] no existing document found`);
    }
  }

  private bootstrapFromMarkdown(doc: Y.Doc, markdown: string): void {
    const { crdtState } = this.crdtService.bootstrapFromMarkdown(markdown);
    Y.applyUpdate(doc, new Uint8Array(crdtState));
  }

  async handleStoreDocument(
    doc: Y.Doc,
    documentId: string,
    userId: string,
    path: string,
  ): Promise<void> {
    const crdtState = Buffer.from(Y.encodeStateAsUpdate(doc));
    const { markdown, plainText } = this.crdtService.materialize(crdtState);
    const title = deriveDocumentTitle(markdown);

    this.logger.log(
      `[store] upsert doc=${documentId} path=${path} userId=${userId} crdt=${crdtState.length}b md=${markdown.length}chars title="${title}"`,
    );

    // Evict any stale row that occupies the same (userId, path) under a different id
    await this.prisma.document.deleteMany({
      where: { userId, path, id: { not: documentId } },
    });

    await this.prisma.document.upsert({
      where: { id: documentId },
      update: {
        path,
        crdtState,
        markdown,
        plainText,
        title,
        embedded: false,
      },
      create: {
        id: documentId,
        userId,
        path,
        crdtState,
        markdown,
        plainText,
        title,
        embedded: false,
      },
    });

    this.logger.log(`[store] upsert complete doc=${documentId}`);
  }
}
