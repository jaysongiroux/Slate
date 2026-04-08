import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CrdtService } from "../documents/crdt.service";
import { HttpAuthGuard } from "../auth/http-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";

interface Session {
  userId: string;
}

const NOTE_SELECT = {
  id: true,
  title: true,
  path: true,
  pinned: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Controller()
export class NotesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crdtService: CrdtService,
  ) {}

  @Get("api/notes/sync")
  @UseGuards(HttpAuthGuard)
  async syncNotes(@Query("since") since: string, @CurrentUser() user: Session) {
    const sinceDate = since ? new Date(since) : new Date(0);
    return this.prisma.document.findMany({
      where: { userId: user.userId, updatedAt: { gt: sinceDate } },
      select: { ...NOTE_SELECT, deleted: true },
      orderBy: { updatedAt: "asc" },
    });
  }

  @Get("api/notes")
  @UseGuards(HttpAuthGuard)
  async listNotes(@CurrentUser() user: Session) {
    return this.prisma.document.findMany({
      where: { userId: user.userId, deleted: false },
      select: NOTE_SELECT,
      orderBy: { updatedAt: "desc" },
    });
  }

  @Post("api/notes")
  @UseGuards(HttpAuthGuard)
  async createNote(
    @Body() body: { id?: string; path: string; title: string },
    @CurrentUser() user: Session,
  ) {
    return this.prisma.document.create({
      data: {
        ...(body.id ? { id: body.id } : {}),
        userId: user.userId,
        path: body.path,
        title: body.title,
        markdown: "",
        plainText: "",
      },
      select: NOTE_SELECT,
    });
  }

  @Patch("api/notes/:id")
  @UseGuards(HttpAuthGuard)
  async updateNote(
    @Param("id") id: string,
    @Body()
    body: {
      path?: string;
      title?: string;
      pinned?: boolean;
      plainText?: string;
      deleted?: boolean;
    },
    @CurrentUser() user: Session,
  ) {
    return this.prisma.document.update({
      where: { id, userId: user.userId },
      data: {
        ...(body.path !== undefined ? { path: body.path } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
        ...(body.plainText !== undefined
          ? { plainText: body.plainText, markdown: body.plainText }
          : {}),
        ...(body.deleted !== undefined ? { deleted: body.deleted } : {}),
      },
      select: NOTE_SELECT,
    });
  }

  @Delete("api/notes/:id")
  @UseGuards(HttpAuthGuard)
  async deleteNote(@Param("id") id: string, @CurrentUser() user: Session) {
    await this.prisma.document.delete({ where: { id, userId: user.userId } });
    return {};
  }

  @Post("api/notes/import")
  @UseGuards(HttpAuthGuard)
  async importNotes(
    @Body()
    body: {
      notes: Array<{
        id?: string;
        path: string;
        title: string;
        markdown?: string;
        plainText?: string;
      }>;
    },
    @CurrentUser() user: Session,
  ) {
    const existing = await this.prisma.document.findMany({
      where: { userId: user.userId, deleted: false },
      select: { path: true },
    });
    const usedPaths = new Set(existing.map((d) => d.path));

    const prepared = body.notes.map((note) => {
      let candidate = note.path;
      let counter = 1;
      while (usedPaths.has(candidate)) {
        candidate = `${note.path}-${counter++}`;
      }
      usedPaths.add(candidate);

      const { crdtState, markdown, plainText } = this.crdtService.bootstrapFromMarkdown(
        note.markdown ?? "",
      );

      return {
        ...(note.id ? { id: note.id } : {}),
        userId: user.userId,
        path: candidate,
        title: note.title,
        markdown,
        plainText,
        crdtState: new Uint8Array(crdtState),
      };
    });

    const importPaths = prepared.map((d) => d.path);
    const created = await this.prisma.$transaction([
      // Evict soft-deleted rows whose paths collide with incoming notes
      this.prisma.document.deleteMany({
        where: { userId: user.userId, path: { in: importPaths }, deleted: true },
      }),
      ...prepared.map((data) => this.prisma.document.create({ data, select: NOTE_SELECT })),
    ]);
    // First element is the deleteMany result, rest are the created notes
    return { created: created.slice(1) };
  }
}
