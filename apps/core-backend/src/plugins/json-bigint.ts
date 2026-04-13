import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { jsonBigIntSafe } from "../lib/json-bigint-safe";

/**
 * Ensures every JSON response can be serialized: Prisma (and AdminJS) may include
 * BigInt fields that `JSON.stringify` rejects. Runs before route/schema serializers.
 */
export default fp(
  async (fastify: FastifyInstance) => {
    fastify.addHook("preSerialization", async (_request, _reply, payload) => {
      return jsonBigIntSafe(payload);
    });
  },
  {
    name: "json-bigint-safe",
    fastify: "5.x",
    encapsulate: false,
  },
);
