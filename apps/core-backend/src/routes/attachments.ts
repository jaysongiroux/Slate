import type { FastifyInstance } from "fastify";

export default async function attachmentsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticateAttachment] };

  fastify.post("/api/attachments/upload", auth, async (request, reply) => {
    const body = request.body as Record<string, any> | undefined;
    const fileField = body?.file;
    if (!fileField || !fileField.toBuffer) {
      reply.code(400);
      return { error: "No file uploaded" };
    }

    const buffer = await fileField.toBuffer();
    const userId = request.userSession!.userId;

    const containerTypeField = body?.containerType;
    const containerIdField = body?.containerId;
    const extractField = (field: unknown): string | undefined => {
      if (field && typeof field === "object" && "value" in (field as any)) {
        return String((field as any).value);
      }
      if (typeof field === "string") return field;
      return undefined;
    };
    const containerType = extractField(containerTypeField);
    const containerId = extractField(containerIdField);

    if (!containerType || !containerId) {
      reply.code(400);
      return { error: "containerType and containerId are required" };
    }
    if (containerType !== "note" && containerType !== "diagram") {
      reply.code(400);
      return { error: "invalid containerType" };
    }

    const attachment = await fastify.attachmentsService.registerAndStore({
      buffer,
      originalName: fileField.filename,
      mimeType: fileField.mimetype,
      sizeBytes: buffer.length,
      userId,
      containerType,
      containerId,
    });

    return {
      id: attachment.id,
      contentUrl: `/api/attachments/${attachment.id}/content`,
    };
  });

  fastify.post("/api/attachments/bulk-import", auth, async (request, reply) => {
    const body = request.body as Record<string, any> | undefined;
    const fileField = body?.file;
    if (!fileField || !fileField.toBuffer) {
      reply.code(400);
      return { error: "No file uploaded" };
    }

    const extractField = (field: unknown): string | undefined => {
      if (field && typeof field === "object" && "value" in (field as any)) {
        return String((field as any).value);
      }
      if (typeof field === "string") return field;
      return undefined;
    };

    const id = extractField(body?.id);
    const containerType = extractField(body?.containerType);
    const containerId = extractField(body?.containerId);
    const originalName = extractField(body?.originalName);
    const mimeType = extractField(body?.mimeType);

    if (!id || !containerType || !containerId || !originalName || !mimeType) {
      reply.code(400);
      return {
        error: "id, containerType, containerId, originalName, mimeType are all required",
      };
    }
    if (containerType !== "note" && containerType !== "diagram") {
      reply.code(400);
      return { error: "invalid containerType" };
    }

    const buffer = await fileField.toBuffer();

    try {
      const attachment = await fastify.attachmentsService.bulkImportOne({
        id,
        buffer,
        originalName,
        mimeType,
        sizeBytes: buffer.length,
        userId: request.userSession!.userId,
        containerType,
        containerId,
      });
      return { id: attachment.id };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 409) {
        reply.code(409);
        return { error: "Attachment id is owned by another user" };
      }
      throw err;
    }
  });

  fastify.get("/api/attachments/list", auth, async (request) => {
    const userId = request.userSession!.userId;
    const attachments = await fastify.attachmentsService.listForUser(userId);
    return { attachments };
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
