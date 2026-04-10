import pino from "pino";
import type { PrismaClient } from "@slate/server-db";
import { unauthorized, forbidden, notFound } from "../lib/errors";
import { deriveDocumentTitle } from "@slate/shared";
import { CrdtService } from "./crdt.service";
import { JobsService } from "../jobs/jobs.service";

type DocumentTransaction = {
  document: PrismaClient["document"];
  deviceCursor: PrismaClient["deviceCursor"];
};

type DocumentEventRecord = {
  id: string;
  path: string;
  deleted: boolean;
  pinned: boolean;
  serverSeq: bigint;
  crdtState: Uint8Array | Buffer | null;
};

export class DocumentsService {
  private readonly logger = pino({ name: "DocumentsService" });

  constructor(
    private readonly prisma: PrismaClient,
    private readonly jobs: JobsService,
    private readonly crdt: CrdtService,
  ) {}

  private requireUser(principal?: { userId?: string }) {
    if (!principal?.userId) {
      throw unauthorized("Missing authenticated user");
    }

    return principal.userId;
  }

  private async nextServerSeq(userId: string, tx: { document: PrismaClient["document"] }) {
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
      pinned: boolean;
      crdtUpdate: Buffer | Uint8Array;
      clientStateVector?: Buffer | Uint8Array;
    },
    principal?: { userId: string },
  ) {
    const userId = this.requireUser(principal);
    const incomingUpdate = Buffer.from(payload.crdtUpdate);
    const crdtBytes = incomingUpdate.length;
    const svBytes = payload.clientStateVector ? Buffer.from(payload.clientStateVector).length : 0;

    this.logger.info(
      `[doc-sync] PushDocumentUpdate begin userId=${userId} clientId=${payload.clientId} documentId=${payload.documentId} path=${payload.path} deleted=${payload.deleted} crdtUpdateBytes=${crdtBytes} clientStateVectorBytes=${svBytes}`,
    );

    const result = await this.prisma.$transaction(async (tx: DocumentTransaction) => {
      const existing = await tx.document.findUnique({
        where: { id: payload.documentId },
      });

      if (existing && existing.userId !== userId) {
        throw forbidden("Document does not belong to this user");
      }

      let currentState: Buffer | null = null;
      if (existing?.crdtState?.length) {
        currentState = Buffer.from(existing.crdtState);
      } else if (existing) {
        currentState = this.crdt.bootstrapFromMarkdown(existing.markdown).crdtState;
      }

      const { mergedState, markdown, plainText, contentChanged } = currentState
        ? this.crdt.mergeUpdate(currentState, incomingUpdate)
        : this.crdt.mergeUpdate(null, incomingUpdate);

      const nextPath = payload.path?.trim() || existing?.path || `${payload.documentId}.md`;
      const nextTitle = deriveDocumentTitle(markdown);

      // Check if anything actually changed compared to the existing document
      const metadataChanged =
        !existing ||
        existing.path !== nextPath ||
        existing.deleted !== payload.deleted ||
        existing.pinned !== (payload.pinned ?? false);

      if (existing && !contentChanged && !metadataChanged) {
        // Nothing changed — return existing state without incrementing serverSeq
        let serverDelta: Uint8Array = new Uint8Array();
        if (payload.clientStateVector && payload.clientStateVector.length > 0) {
          serverDelta = this.crdt.computeDelta(mergedState, Buffer.from(payload.clientStateVector));
        }

        return {
          document: existing,
          serverDelta,
          nextServerSeq: existing.serverSeq,
          outcome: "noop" as const,
        };
      }

      const nextServerSeq = await this.nextServerSeq(userId, tx);

      let serverDelta: Uint8Array = new Uint8Array();
      if (payload.clientStateVector && payload.clientStateVector.length > 0) {
        serverDelta = this.crdt.computeDelta(mergedState, Buffer.from(payload.clientStateVector));
      }

      // Remove any stale document that occupies the target path (different ID,
      // same user+path). This can happen when a note is moved/renamed and the
      // old record wasn't cleaned up, or when two devices create at the same path.
      const pathConflict = await tx.document.findFirst({
        where: { userId, path: nextPath, id: { not: payload.documentId } },
      });
      if (pathConflict) {
        await tx.document.delete({ where: { id: pathConflict.id } });
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
              pinned: payload.pinned ?? false,
              crdtState: new Uint8Array(mergedState),
              serverSeq: nextServerSeq,
              embedded: false,
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
              pinned: payload.pinned ?? false,
              crdtState: new Uint8Array(mergedState),
              serverSeq: nextServerSeq,
              embedded: false,
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

      return {
        document,
        serverDelta,
        nextServerSeq,
        outcome: (existing ? "updated" : "created") as "updated" | "created",
      };
    });

    const outcome = "outcome" in result ? result.outcome : "unknown";
    const seqStr = String(result.nextServerSeq);
    if (outcome === "noop") {
      this.logger.info(
        `[doc-sync] PushDocumentUpdate noop (no DB write) userId=${userId} documentId=${payload.documentId} path=${payload.path} serverSeq=${seqStr}`,
      );
    } else {
      this.logger.info(
        `[doc-sync] PushDocumentUpdate persisted userId=${userId} documentId=${result.document.id} path=${result.document.path} outcome=${outcome} serverSeq=${seqStr} title=${result.document.title}`,
      );
    }

    try {
      await this.jobs.enqueue("search-index", {
        userId,
        documentId: result.document.id,
      });
    } catch (error) {
      this.logger.warn(
        `search-index enqueue failed (document ${result.document.id} still saved): ${error instanceof Error ? error.message : error}`,
      );
    }

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

    this.logger.info(
      `[doc-sync] PullDocumentEvents begin userId=${userId} clientId=${payload.clientId} sinceServerSeq=${sinceServerSeq.toString()}`,
    );

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

    const mapped = documents.map((document: DocumentEventRecord) => ({
      documentId: document.id,
      path: document.path,
      deleted: document.deleted,
      pinned: document.pinned,
      serverSeq: Number(document.serverSeq),
      crdtState: document.crdtState ?? Buffer.alloc(0),
    }));

    this.logger.info(
      `[doc-sync] PullDocumentEvents done userId=${userId} clientId=${payload.clientId} returned=${mapped.length} latestServerSeq=${latestServerSeq.toString()} ids=${mapped.map((d: { documentId: string }) => d.documentId).join(",") || "(none)"}`,
    );

    return {
      documents: mapped,
      latestServerSeq: Number(latestServerSeq),
    };
  }

  async getDocumentSnapshot(payload: { documentId: string }, principal?: { userId: string }) {
    const userId = this.requireUser(principal);
    this.logger.info(
      `[doc-sync] GetDocumentSnapshot userId=${userId} documentId=${payload.documentId}`,
    );

    const existing = await this.prisma.document.findUnique({
      where: { id: payload.documentId },
    });

    if (!existing || existing.userId !== userId) {
      this.logger.warn(
        `[doc-sync] GetDocumentSnapshot not found or wrong user documentId=${payload.documentId} userId=${userId}`,
      );
      throw notFound("Document not found");
    }

    let crdtState: Uint8Array = existing.crdtState
      ? Buffer.from(existing.crdtState)
      : new Uint8Array();
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
