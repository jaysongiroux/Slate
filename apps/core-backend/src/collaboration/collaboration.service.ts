import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import * as Y from "yjs";

@Injectable()
export class CollaborationService {
  private readonly logger = new Logger(CollaborationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleLoadDocument(
    doc: Y.Doc,
    documentId: string,
    userId: string,
  ): Promise<void> {
    this.logger.log(
      `[load] looking up doc id=${documentId} userId=${userId}`,
    );
    const record = await this.prisma.document.findFirst({
      where: { id: documentId, userId },
      select: { crdtState: true },
    });

    if (record?.crdtState) {
      this.logger.log(
        `[load] found existing crdtState (${record.crdtState.length} bytes)`,
      );
      Y.applyUpdate(doc, new Uint8Array(record.crdtState));
    } else {
      this.logger.log(`[load] no existing document found`);
    }
  }

  async handleStoreDocument(
    doc: Y.Doc,
    documentId: string,
    userId: string,
    path: string,
  ): Promise<void> {
    const crdtState = Buffer.from(Y.encodeStateAsUpdate(doc));
    const markdown = this.materializeMarkdown(doc);
    const plainText = markdown.replace(/[#*_`~\[\]()>|-]/g, "").trim();
    const title = this.extractTitle(markdown);

    this.logger.log(
      `[store] upsert doc=${documentId} path=${path} userId=${userId} crdt=${crdtState.length}b md=${markdown.length}chars title="${title}"`,
    );

    await this.prisma.document.upsert({
      where: { userId_path: { userId, path } },
      update: {
        crdtState,
        markdown,
        plainText,
        title,
      },
      create: {
        id: documentId,
        userId,
        path,
        crdtState,
        markdown,
        plainText,
        title,
      },
    });

    this.logger.log(`[store] upsert complete doc=${documentId}`);
  }

  private materializeMarkdown(doc: Y.Doc): string {
    const fragment = doc.getXmlFragment("default");
    return this.xmlFragmentToMarkdown(fragment);
  }

  private xmlFragmentToMarkdown(fragment: Y.XmlFragment): string {
    const lines: string[] = [];
    for (let i = 0; i < fragment.length; i++) {
      const child = fragment.get(i);
      if (child instanceof Y.XmlElement) {
        const nodeName = child.nodeName;
        const text = child.toString();
        const clean = text.replace(/<[^>]+>/g, "");
        if (nodeName === "heading") {
          const level = child.getAttribute("level") || 1;
          lines.push(`${"#".repeat(Number(level))} ${clean}`);
        } else if (nodeName === "paragraph") {
          lines.push(clean);
        } else if (nodeName === "bulletList" || nodeName === "orderedList") {
          lines.push(clean);
        } else if (nodeName === "codeBlock") {
          lines.push("```\n" + clean + "\n```");
        } else {
          lines.push(clean);
        }
      } else if (child instanceof Y.XmlText) {
        lines.push(child.toString());
      }
    }
    return lines.join("\n\n");
  }

  private extractTitle(markdown: string): string {
    const match = markdown.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : "Untitled";
  }
}
