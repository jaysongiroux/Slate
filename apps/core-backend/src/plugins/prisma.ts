import fp from "fastify-plugin";
import { PrismaClient } from "@slate/server-db";
import type { FastifyInstance } from "fastify";

export default fp(async function prismaPlugin(fastify: FastifyInstance) {
  const prisma = new PrismaClient();
  await prisma.$connect();
  fastify.log.info("Prisma connected");

  fastify.decorate("prisma", prisma);

  fastify.addHook("onClose", async () => {
    await prisma.$disconnect();
    fastify.log.info("Prisma disconnected");
  });
});
