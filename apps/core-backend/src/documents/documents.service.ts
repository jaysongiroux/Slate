import { Injectable } from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";
import { status } from "@grpc/grpc-js";
import path from "node:path";
import { CrdtService } from "./crdt.service";
import { JobsService } from "../jobs/jobs.service";
import { PrismaService } from "../prisma/prisma.service";

function titleFromMarkdown(markdown: string, fallbackPath?: string) {
  const heading = markdown.split("\n").find((line) => line.startsWith("# "));
  if (heading) {
    return heading.replace(/^#\s+/, "").trim();
  }

  if (fallbackPath) {
    return path.basename(fallbackPath, ".md");
  }

  return "Untitled";
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly crdt: CrdtService,
  ) {}

  private requireUser(principal?: { userId?: string }) {
    if (!principal?.userId) {
      throw new RpcException({ code: status.UNAUTHENTICATED, message: "Missing authenticated user" });
    }

    return principal.userId;
  }

  private async nextServerSeq(userId: string, tx: { document: PrismaService["document"] }) {
    const lastDocument = await tx.document.findFirst({
      where: { userId },
      orderBy: { serverSeq: "desc" },
      select: { serverSeq: true },
    });

    return (lastDocument?.serverSeq ?? BigInt(0)) + BigInt(1);
  }

  async pushDocumentUpdate(
    payload: {
      clientId: string;
      documentId: string;
      path: string;
      deleted: boolean;
      crdtUpdate: Buffer | Uint8Array;
      clientStateVector?: Buffer | Uint8Array;
    },
    principal?: { userId: string },
  ) {
    const userId = this.requireUser(principal);
    const incomingUpdate = Buffer.from(payload.crdtUpdate);

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.document.findUnique({
        where: { id: payload.documentId },
      });

      if (existing && existing.userId !== userId) {
        throw new RpcException({ code: status.PERMISSION_DENIED, message: "Document does not belong to this user" });
      }

      let currentState: Buffer | null = null;
      if (existing?.crdtState?.length) {
        currentState = Buffer.from(existing.crdtState);
      } else if (existing) {
        currentState = this.crdt.bootstrapFromMarkdown(existing.markdown).crdtState;
      }

      const { mergedState, markdown, plainText } = currentState
        ? this.crdt.mergeUpdate(currentState, incomingUpdate)
        : this.crdt.mergeUpdate(null, incomingUpdate);

      const nextServerSeq = await this.nextServerSeq(userId, tx);
      const nextPath = payload.path?.trim() || existing?.path || `${payload.documentId}.md`;
      const nextTitle = titleFromMarkdown(markdown, nextPath);

      let serverDelta: Uint8Array = new Uint8Array();
      if (payload.clientStateVector && payload.clientStateVector.length > 0) {
        serverDelta = this.crdt.computeDelta(mergedState, Buffer.from(payload.clientStateVector));
      }

      const document = existing
        ? await tx.document.update({
            where: { id: payload.documentId },
            data: {
              path: nextPath,
              title: nextTitle,
              markdown,
              plainText,
              deleted: payload.deleted,
              crdtState: new Uint8Array(mergedState),
              serverSeq: nextServerSeq,
            },
          })
        : await tx.document.create({
            data: {
              id: payload.documentId,
              userId,
              path: nextPath,
              title: nextTitle,
              markdown,
              plainText,
              deleted: payload.deleted,
              crdtState: new Uint8Array(mergedState),
              serverSeq: nextServerSeq,
            },
          });

      await tx.deviceCursor.upsert({
        where: {
          userId_clientId: {
            userId,
            clientId: payload.clientId,
          },
        },
        create: {
          userId,
          clientId: payload.clientId,
          lastServerSeq: nextServerSeq,
        },
        update: {
          lastServerSeq: nextServerSeq,
        },
      });

      return { document, serverDelta, nextServerSeq };
    });

    await this.jobs.enqueue("search-index", {
      userId,
      documentId: result.document.id,
    });

    return {
      serverSeq: Number(result.nextServerSeq),
      serverDelta: result.serverDelta,
      path: result.document.path,
      deleted: result.document.deleted,
    };
  }

  async pullDocumentEvents(
    payload: { clientId: string; sinceServerSeq: string | number },
    principal?: { userId: string },
  ) {
    const userId = this.requireUser(principal);
    const sinceServerSeq = BigInt(payload.sinceServerSeq ?? 0);

    const documents = await this.prisma.document.findMany({
      where: {
        userId,
        serverSeq: { gt: sinceServerSeq },
      },
      orderBy: { serverSeq: "asc" },
    });

    const latestServerSeq = documents.at(-1)?.serverSeq ?? sinceServerSeq;

    await this.prisma.deviceCursor.upsert({
      where: {
        userId_clientId: {
          userId,
          clientId: payload.clientId,
        },
      },
      create: {
        userId,
        clientId: payload.clientId,
        lastServerSeq: latestServerSeq,
      },
      update: {
        lastServerSeq: latestServerSeq,
      },
    });

    return {
      documents: documents.map((document) => ({
        documentId: document.id,
        path: document.path,
        deleted: document.deleted,
        serverSeq: Number(document.serverSeq),
        crdtState: document.crdtState ?? Buffer.alloc(0),
      })),
      latestServerSeq: Number(latestServerSeq),
    };
  }

  async getDocumentSnapshot(
    payload: { documentId: string },
    principal?: { userId: string },
  ) {
    const userId = this.requireUser(principal);
    const existing = await this.prisma.document.findUnique({
      where: { id: payload.documentId },
    });

    if (!existing || existing.userId !== userId) {
      throw new RpcException({ code: status.NOT_FOUND, message: "Document not found" });
    }

    let crdtState: Uint8Array = existing.crdtState ? Buffer.from(existing.crdtState) : new Uint8Array();
    if (!crdtState.length) {
      const bootstrapped = this.crdt.bootstrapFromMarkdown(existing.markdown);
      crdtState = bootstrapped.crdtState;
      await this.prisma.document.update({
        where: { id: existing.id },
        data: { crdtState: new Uint8Array(crdtState) },
      });
    }

    return {
      documentId: existing.id,
      path: existing.path,
      deleted: existing.deleted,
      serverSeq: Number(existing.serverSeq),
      crdtState,
    };
  }
}
