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
  constructor(private readonly prisma: PrismaService) {}

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
    const created = await this.prisma.$transaction(
      body.notes.map((note) =>
        this.prisma.document.create({
          data: {
            ...(note.id ? { id: note.id } : {}),
            userId: user.userId,
            path: note.path,
            title: note.title,
            markdown: note.markdown ?? "",
            plainText: note.plainText ?? "",
          },
          select: NOTE_SELECT,
        }),
      ),
    );
    return { created };
  }
}
