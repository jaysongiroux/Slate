import type { FastifyInstance } from "fastify";

export default async function attachmentsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticateAttachment] };

  fastify.post("/api/attachments/upload", auth, async (request, reply) => {
    const data = await (request as any).file();
    if (!data) {
      reply.code(400);
      return { error: "No file uploaded" };
    }

    const buffer = await data.toBuffer();
    const userId = request.userSession!.userId;
    const fields = data.fields as Record<string, any>;
    const documentIdField = fields?.documentId;
    const documentId =
      documentIdField && typeof documentIdField === "object" && "value" in documentIdField
        ? (documentIdField.value as string)
        : undefined;

    const attachment = await fastify.attachmentsService.registerAndStore({
      buffer,
      originalName: data.filename,
      mimeType: data.mimetype,
      sizeBytes: buffer.length,
      userId,
      documentId: documentId ?? "",
    });

    return {
      id: attachment.id,
      contentUrl: `/api/attachments/${attachment.id}/content`,
    };
  });

  fastify.get("/api/attachments/:id/content", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await fastify.attachmentsService.getContentStream(
      id,
      request.userSession!.userId,
    );

    reply.headers({
      "Content-Type": result.mimeType,
      "Cache-Control": "private, max-age=31536000, immutable",
    });

    return reply.send(result.stream);
  });
}
