import type { PrismaClient } from "@slate/server-db";
import type { Diagram, Prisma } from "@prisma/client";
import { notFound } from "../lib/errors";

export class DiagramsService {
  constructor(private readonly prisma: PrismaClient) {}

  list(input: { userId: string }): Promise<Diagram[]> {
    return this.prisma.diagram.findMany({
      where: { userId: input.userId, deleted: false },
      orderBy: { updatedAt: "desc" },
    });
  }

  async get(input: { userId: string; id: string }): Promise<Diagram> {
    const diagram = await this.prisma.diagram.findFirst({
      where: { id: input.id, userId: input.userId, deleted: false },
    });
    if (!diagram) throw notFound("Diagram not found");
    return diagram;
  }

  create(input: { userId: string; title: string }): Promise<Diagram> {
    return this.prisma.diagram.create({
      data: {
        userId: input.userId,
        title: input.title,
        scene: {} as Prisma.InputJsonValue,
      },
    });
  }

  async update(input: {
    userId: string;
    id: string;
    title?: string;
    scene?: Prisma.InputJsonValue;
  }): Promise<Diagram> {
    const owned = await this.prisma.diagram.findFirst({
      where: { id: input.id, userId: input.userId },
    });
    if (!owned) throw notFound("Diagram not found");

    const data: Prisma.DiagramUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.scene !== undefined) data.scene = input.scene;

    return this.prisma.diagram.update({ where: { id: input.id }, data });
  }

  async softDelete(input: { userId: string; id: string }): Promise<void> {
    const owned = await this.prisma.diagram.findFirst({
      where: { id: input.id, userId: input.userId },
    });
    if (!owned) throw notFound("Diagram not found");
    await this.prisma.diagram.update({
      where: { id: input.id },
      data: { deleted: true },
    });
  }
}
