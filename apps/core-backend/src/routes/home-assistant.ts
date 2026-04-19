import type { FastifyInstance, FastifyReply } from "fastify";
import type { HomeAssistantControlRequest, HomeAssistantLiveEvent } from "@slate/shared";
import { formatHomeAssistantError } from "../home-assistant/home-assistant.errors";

function sendFormattedHomeAssistantError(reply: FastifyReply, err: unknown) {
  const formatted = formatHomeAssistantError(err);
  return reply.code(400).send({ code: formatted.code, error: formatted.message });
}

export default async function homeAssistantRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get("/api/home-assistant/instances", auth, async (request) => {
    return {
      instances: await fastify.homeAssistantService.listInstances(request.user!.userId),
    };
  });

  fastify.post("/api/home-assistant/instances", auth, async (request, reply) => {
    const body = request.body as { url: string; token: string; name?: string };
    try {
      const instance = await fastify.homeAssistantService.addInstance(
        request.user!.userId,
        body.url,
        body.token,
        body.name,
      );
      return { instance };
    } catch (err) {
      return sendFormattedHomeAssistantError(reply, err);
    }
  });

  fastify.delete("/api/home-assistant/instances/:id", auth, async (request) => {
    const { id } = request.params as { id: string };
    await fastify.homeAssistantService.removeInstance(request.user!.userId, id);
    return { ok: true };
  });

  fastify.post("/api/home-assistant/instances/:id/test", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await fastify.homeAssistantService.testConnection(request.user!.userId, id);
      return { ok: true };
    } catch (err) {
      return sendFormattedHomeAssistantError(reply, err);
    }
  });

  fastify.get("/api/home-assistant/:instanceId/dashboards", auth, async (request, reply) => {
    const { instanceId } = request.params as { instanceId: string };
    try {
      const dashboards = await fastify.homeAssistantService.getDashboards(
        request.user!.userId,
        instanceId,
      );
      return { dashboards };
    } catch (err) {
      return sendFormattedHomeAssistantError(reply, err);
    }
  });

  fastify.get(
    "/api/home-assistant/:instanceId/dashboards/:dashboardId",
    auth,
    async (request, reply) => {
      const { instanceId, dashboardId } = request.params as {
        instanceId: string;
        dashboardId: string;
      };
      try {
        return await fastify.homeAssistantService.getDashboardSummary(
          request.user!.userId,
          instanceId,
          dashboardId,
        );
      } catch (err) {
        return sendFormattedHomeAssistantError(reply, err);
      }
    },
  );

  fastify.get("/api/home-assistant/:instanceId/areas", auth, async (request, reply) => {
    const { instanceId } = request.params as { instanceId: string };
    try {
      const areas = await fastify.homeAssistantService.getAreas(request.user!.userId, instanceId);
      request.log.info({ instanceId, areaCount: areas.length }, "home assistant areas loaded");
      return { areas };
    } catch (err) {
      return sendFormattedHomeAssistantError(reply, err);
    }
  });

  fastify.get("/api/home-assistant/:instanceId/devices", auth, async (request, reply) => {
    const { instanceId } = request.params as { instanceId: string };
    try {
      const devices = await fastify.homeAssistantService.getDevices(
        request.user!.userId,
        instanceId,
      );
      request.log.info(
        {
          instanceId,
          deviceCount: devices.length,
          areaLinkedDeviceCount: devices.filter((device) => Boolean(device.areaId)).length,
        },
        "home assistant devices loaded",
      );
      return { devices };
    } catch (err) {
      return sendFormattedHomeAssistantError(reply, err);
    }
  });

  fastify.get("/api/home-assistant/:instanceId/entities", auth, async (request, reply) => {
    const { instanceId } = request.params as { instanceId: string };
    try {
      const entities = await fastify.homeAssistantService.getEntities(
        request.user!.userId,
        instanceId,
      );
      request.log.info(
        {
          instanceId,
          entityCount: entities.length,
          deviceLinkedEntityCount: entities.filter((entity) => Boolean(entity.deviceId)).length,
          areaLinkedEntityCount: entities.filter((entity) => Boolean(entity.areaId)).length,
        },
        "home assistant entities loaded",
      );
      return { entities };
    } catch (err) {
      return sendFormattedHomeAssistantError(reply, err);
    }
  });

  fastify.get(
    "/api/home-assistant/:instanceId/entities/:entityId",
    auth,
    async (request, reply) => {
      const { instanceId, entityId } = request.params as { instanceId: string; entityId: string };
      try {
        const entity = await fastify.homeAssistantService.getEntity(
          request.user!.userId,
          instanceId,
          entityId,
        );
        return { entity };
      } catch (err) {
        return sendFormattedHomeAssistantError(reply, err);
      }
    },
  );

  const imageAuth = { preHandler: [fastify.authenticateAttachment] };

  fastify.get(
    "/api/home-assistant/:instanceId/cameras/:entityId/snapshot",
    imageAuth,
    async (request, reply) => {
      const { instanceId, entityId } = request.params as {
        instanceId: string;
        entityId: string;
      };
      try {
        const result = await fastify.homeAssistantService.getCameraSnapshot(
          request.userSession!.userId,
          instanceId,
          entityId,
        );
        if (!result.body || result.status !== 200) {
          return reply.code(result.status || 404).send();
        }

        reply.header("Content-Type", result.contentType);
        reply.header("Cache-Control", "private, no-store");
        return reply.send(result.body);
      } catch (err) {
        const formatted = formatHomeAssistantError(err);
        return reply.code(400).send({ code: formatted.code, error: formatted.message });
      }
    },
  );

  fastify.get("/api/home-assistant/:instanceId/events", auth, async (request, reply) => {
    const { instanceId } = request.params as { instanceId: string };

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const writeEvent = (event: HomeAssistantLiveEvent) => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    reply.raw.write(":\n\n");
    writeEvent({ type: "status", status: "connecting" });

    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(":\n\n");
      }
    }, 30000);

    let unsubscribe: (() => void) | null = null;
    let closed = false;
    const cleanup = () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe?.();
      unsubscribe = null;
    };

    request.raw.on("close", cleanup);

    try {
      unsubscribe = await fastify.homeAssistantService.subscribeStateChanges(
        request.user!.userId,
        instanceId,
        {
          onState: (state) => writeEvent({ type: "state_changed", state }),
          onStatus: (status) => {
            request.log.info({ instanceId, status }, "home assistant websocket status");
            writeEvent({ type: "status", status });
          },
          onError: (err) => {
            const formatted = formatHomeAssistantError(err);
            request.log.warn(
              { instanceId, code: formatted.code, error: formatted.message },
              "home assistant stream error",
            );
            writeEvent({ type: "error", message: formatted.message });
          },
        },
      );
      if (closed) {
        unsubscribe();
        unsubscribe = null;
      }
    } catch (err) {
      const formatted = formatHomeAssistantError(err);
      request.log.warn(
        { instanceId, code: formatted.code, error: formatted.message },
        "home assistant stream subscription failed",
      );
      writeEvent({ type: "error", message: formatted.message });
      writeEvent({ type: "status", status: "error", message: formatted.message });
      cleanup();
      reply.raw.end();
    }
  });

  fastify.get("/api/home-assistant/:instanceId/state", auth, async (request, reply) => {
    const { instanceId } = request.params as { instanceId: string };
    try {
      const states = await fastify.homeAssistantService.getStates(request.user!.userId, instanceId);
      return { states };
    } catch (err) {
      return sendFormattedHomeAssistantError(reply, err);
    }
  });

  fastify.post("/api/home-assistant/:instanceId/control", auth, async (request, reply) => {
    const { instanceId } = request.params as { instanceId: string };
    const body = request.body as HomeAssistantControlRequest;
    try {
      return await fastify.homeAssistantService.control(request.user!.userId, instanceId, body);
    } catch (err) {
      return sendFormattedHomeAssistantError(reply, err);
    }
  });
}
