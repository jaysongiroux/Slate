import { Injectable } from "@nestjs/common";
import { JobsService } from "../jobs/jobs.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService
  ) {}

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
  }) {
    const knownRevision = BigInt(payload.knownServerRevision ?? 0);
    const existing = await this.prisma.document.findUnique({ where: { id: payload.document.id } });

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
        workspaceId: payload.workspaceId,
        ownerUserId: payload.document.ownerUserId,
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
          workspaceId: payload.workspaceId,
          clientId: payload.clientId
        }
      },
      create: {
        workspaceId: payload.workspaceId,
        clientId: payload.clientId,
        lastSeenRevision: nextRevision
      },
      update: {
        lastSeenRevision: nextRevision
      }
    });

    await this.jobs.enqueue("search-index", {
      workspaceId: payload.workspaceId,
      documentId: document.id
    });

    return {
      document: this.toProtoDocument(document)
    };
  }

  async remove(payload: { clientId: string; workspaceId: string; documentId: string; knownServerRevision: string | number }) {
    const existing = await this.prisma.document.findUniqueOrThrow({ where: { id: payload.documentId } });
    return this.upsert({
      clientId: payload.clientId,
      workspaceId: payload.workspaceId,
      knownServerRevision: payload.knownServerRevision,
      document: {
        id: existing.id,
        ownerUserId: existing.ownerUserId,
        title: existing.title,
        path: existing.path,
        markdown: existing.markdown,
        plainText: existing.plainText,
        deleted: true
      }
    });
  }

  async pull(payload: { clientId: string; workspaceId: string; lastSeenRevision: string | number }) {
    const lastSeenRevision = BigInt(payload.lastSeenRevision ?? 0);
    const documents = await this.prisma.document.findMany({
      where: {
        workspaceId: payload.workspaceId,
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
          workspaceId: payload.workspaceId,
          clientId: payload.clientId
        }
      },
      create: {
        workspaceId: payload.workspaceId,
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
