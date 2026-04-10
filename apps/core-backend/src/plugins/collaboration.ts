import fp from "fastify-plugin";
import { Hocuspocus } from "@hocuspocus/server";
import { WebSocketServer } from "ws";
import type { FastifyInstance } from "fastify";

export default fp(async function collaborationPlugin(fastify: FastifyInstance) {
  const { authSession, collaborationService } = fastify;
  const log = fastify.log;

  // ---------------------------------------------------------------------------
  // Hocuspocus server — mirrors CollaborationGateway config exactly
  // ---------------------------------------------------------------------------
  const hocuspocus = new Hocuspocus({
    name: "slate-collaboration",
    timeout: 30000,
    debounce: 2000,
    maxDebounce: 10000,

    async onAuthenticate(data) {
      const token = data.token;
      log.info(`[collab][auth] token present: ${!!token}, length: ${token?.length ?? 0}`);
      if (!token) {
        throw new Error("No authentication token provided");
      }
      try {
        const session = await authSession.validateAccessToken(token);
        log.info(`[collab][auth] authenticated userId=${session.userId}`);
        return { userId: session.userId };
      } catch (err) {
        log.error(`[collab][auth] failed: ${err}`);
        throw err;
      }
    },

    async onLoadDocument(data) {
      const context = data.context as { userId: string };
      log.info(`[collab][load] doc=${data.documentName} userId=${context.userId}`);
      await collaborationService.handleLoadDocument(
        data.document,
        data.documentName,
        context.userId,
      );
      log.info(`[collab][load] complete doc=${data.documentName} size=${data.document.share.size}`);
    },

    async onStoreDocument(data) {
      const context = data.context as { userId: string };
      const path = (data.document.getMap("meta").get("path") as string) || data.documentName;
      log.info(`[collab][store] doc=${data.documentName} userId=${context.userId} path=${path}`);
      try {
        await collaborationService.handleStoreDocument(
          data.document,
          data.documentName,
          context.userId,
          path,
        );
        log.info(`[collab][store] complete doc=${data.documentName}`);
      } catch (err) {
        log.error(`[collab][store] failed doc=${data.documentName}: ${err}`);
        throw err;
      }
    },

    async onConnect(data) {
      log.info(
        `[collab][connect] doc=${data.documentName} clients=${data.instance.getConnectionsCount()}`,
      );
    },

    async onDisconnect(data) {
      log.info(
        `[collab][disconnect] doc=${data.documentName} clients=${data.instance.getConnectionsCount()}`,
      );
    },
  });

  log.info("Hocuspocus collaboration server configured");

  // ---------------------------------------------------------------------------
  // WebSocket upgrade handling — mirrors main.ts bootstrap wiring
  // ---------------------------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true });

  fastify.addHook("onReady", async () => {
    fastify.server.on("upgrade", (request, socket, head) => {
      log.info(`[ws-upgrade] url=${request.url}`);
      if (request.url?.startsWith("/collaboration")) {
        wss.handleUpgrade(request, socket, head, (ws) => {
          log.info("[ws-upgrade] handshake complete, passing to Hocuspocus");
          hocuspocus.handleConnection(ws, request);
        });
      } else {
        log.info(`[ws-upgrade] ignoring non-collaboration path: ${request.url}`);
        socket.destroy();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------
  fastify.addHook("onClose", async () => {
    await hocuspocus.closeConnections();
    log.info("Hocuspocus connections closed");
  });
});
