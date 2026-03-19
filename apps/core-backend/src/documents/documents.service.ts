import { Injectable } from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";
import { status } from "@grpc/grpc-js";
import { JobsService } from "../jobs/jobs.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService
  ) {}

  normalizePrincipal(payload: {
    workspaceId: string;
    document?: { ownerUserId: string };
  }, principal?: { userId: string; workspaceId: string }): { userId: string; workspaceId: string } {
    const candidate = principal ?? {
      workspaceId: payload.workspaceId,
      userId: payload.document?.ownerUserId,
    };

    if (!candidate.userId) {
      throw new RpcException({ code: status.UNAUTHENTICATED, message: "Missing document owner identity" });
    }

    return {
      workspaceId: candidate.workspaceId,
      userId: candidate.userId,
    };
  }

  async upsert(payload: {
    clientId: string;
    workspaceId: string;
    knownServerRevision: string | number;
    document: {
      id: string;
      ownerUserId: string;
      title: string;
      path: string;
      markdown: string;
      plainText: string;
      deleted?: boolean;
    };
  }, principal?: { userId: string; workspaceId: string }) {
    const resolvedPrincipal = this.normalizePrincipal(payload, principal);
    const knownRevision = BigInt(payload.knownServerRevision ?? 0);
    const existing = await this.prisma.document.findUnique({ where: { id: payload.document.id } });

    if (existing && existing.workspaceId !== resolvedPrincipal.workspaceId) {
      throw new RpcException({ code: status.PERMISSION_DENIED, message: "Document does not belong to this workspace" });
    }

    if (existing && existing.acceptedRevision > knownRevision) {
      return {
        document: this.toProtoDocument(existing),
        conflict: {
          documentId: existing.id,
          serverRevision: Number(existing.acceptedRevision),
          serverDocument: this.toProtoDocument(existing)
        }
      };
    }

    const nextRevision = (existing?.acceptedRevision ?? BigInt(0)) + BigInt(1);
    const document = await this.prisma.document.upsert({
      where: { id: payload.document.id },
      create: {
        id: payload.document.id,
        workspaceId: resolvedPrincipal.workspaceId,
        ownerUserId: resolvedPrincipal.userId,
        title: payload.document.title,
        path: payload.document.path,
        markdown: payload.document.markdown,
        plainText: payload.document.plainText,
        deleted: payload.document.deleted ?? false,
        acceptedRevision: nextRevision
      },
      update: {
        title: payload.document.title,
        path: payload.document.path,
        markdown: payload.document.markdown,
        plainText: payload.document.plainText,
        deleted: payload.document.deleted ?? false,
        acceptedRevision: nextRevision
      }
    });

    await this.prisma.clientBinding.upsert({
      where: {
        workspaceId_clientId: {
          workspaceId: resolvedPrincipal.workspaceId,
          clientId: payload.clientId
        }
      },
      create: {
        workspaceId: resolvedPrincipal.workspaceId,
        clientId: payload.clientId,
        lastSeenRevision: nextRevision
      },
      update: {
        lastSeenRevision: nextRevision
      }
    });

    await this.jobs.enqueue("search-index", {
      workspaceId: resolvedPrincipal.workspaceId,
      documentId: document.id
    });

    return {
      document: this.toProtoDocument(document)
    };
  }

  async remove(payload: { clientId: string; workspaceId: string; documentId: string; knownServerRevision: string | number }, principal?: { userId: string; workspaceId: string }) {
    const existing = await this.prisma.document.findUniqueOrThrow({ where: { id: payload.documentId } });
    const resolvedPrincipal = principal ?? { userId: existing.ownerUserId, workspaceId: payload.workspaceId };
    if (existing.workspaceId !== resolvedPrincipal.workspaceId) {
      throw new RpcException({ code: status.PERMISSION_DENIED, message: "Document does not belong to this workspace" });
    }
    return this.upsert({
      clientId: payload.clientId,
      workspaceId: resolvedPrincipal.workspaceId,
      knownServerRevision: payload.knownServerRevision,
      document: {
        id: existing.id,
        ownerUserId: resolvedPrincipal.userId,
        title: existing.title,
        path: existing.path,
        markdown: existing.markdown,
        plainText: existing.plainText,
        deleted: true
      }
    }, resolvedPrincipal);
  }

  async pull(payload: { clientId: string; workspaceId: string; lastSeenRevision: string | number }, principal?: { workspaceId: string }) {
    const resolvedPrincipal = principal ?? { workspaceId: payload.workspaceId };
    const lastSeenRevision = BigInt(payload.lastSeenRevision ?? 0);
    const documents = await this.prisma.document.findMany({
      where: {
        workspaceId: resolvedPrincipal.workspaceId,
        acceptedRevision: {
          gt: lastSeenRevision
        }
      },
      orderBy: {
        acceptedRevision: "asc"
      }
    });

    const latestRevision = documents.at(-1)?.acceptedRevision ?? lastSeenRevision;

    await this.prisma.clientBinding.upsert({
      where: {
        workspaceId_clientId: {
          workspaceId: resolvedPrincipal.workspaceId,
          clientId: payload.clientId
        }
      },
      create: {
        workspaceId: resolvedPrincipal.workspaceId,
        clientId: payload.clientId,
        lastSeenRevision: latestRevision
      },
      update: {
        lastSeenRevision: latestRevision
      }
    });

    return {
      documents: documents.map((document: {
        id: string;
        workspaceId: string;
        ownerUserId: string;
        title: string;
        path: string;
        markdown: string;
        plainText: string;
        updatedAt: Date;
        acceptedRevision: bigint;
        deleted: boolean;
      }) => this.toProtoDocument(document)),
      latestRevision: Number(latestRevision)
    };
  }

  private toProtoDocument(document: {
    id: string;
    workspaceId: string;
    ownerUserId: string;
    title: string;
    path: string;
    markdown: string;
    plainText: string;
    updatedAt: Date;
    acceptedRevision: bigint;
    deleted: boolean;
  }) {
    return {
      id: document.id,
      workspaceId: document.workspaceId,
      ownerUserId: document.ownerUserId,
      title: document.title,
      path: document.path,
      markdown: document.markdown,
      plainText: document.plainText,
      updatedAtUnix: Math.floor(document.updatedAt.getTime() / 1000),
      acceptedRevision: Number(document.acceptedRevision),
      deleted: document.deleted
    };
  }
}
